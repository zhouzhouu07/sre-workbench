import { z } from "zod";
import type { Backend } from "../core/backend";
import type { AgentTarget, AgentToolCall } from "../../shared/agent";
import { shellQuote as q } from "../core/safety";

export const verificationSchemas = {
  verify_file: z
    .object({
      path: z
        .string()
        .min(1)
        .max(4096)
        .refine((v) => !/[\x00-\x1f]/.test(v)),
      format: z.enum(["binary", "text", "json", "python"]).default("binary"),
      minBytes: z.number().int().min(0).max(1048576).default(1),
      expectText: z.string().min(1).max(1000).optional(),
      sha256: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/)
        .optional(),
      mode: z
        .string()
        .regex(/^[0-7]{3,4}$/)
        .optional(),
    })
    .strict(),
  verify_package: z
    .object({
      name: z
        .string()
        .min(1)
        .max(160)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9+_.:-]*$/),
      version: z
        .string()
        .min(1)
        .max(100)
        .refine((v) => !/[\x00-\x1f]/.test(v))
        .optional(),
    })
    .strict(),
};
export const verificationCheckSchema = z.discriminatedUnion("tool", [
  z
    .object({
      tool: z.literal("verify_file"),
      arguments: verificationSchemas.verify_file,
    })
    .strict(),
  z
    .object({
      tool: z.literal("verify_package"),
      arguments: verificationSchemas.verify_package,
    })
    .strict(),
]);

// Parses Python source with ast only: never imports or executes the target file.
export const fileVerificationScript = `import os,sys,json,stat,hashlib,ast
a=json.loads(sys.argv[2])
def invalid_constant(value): raise ValueError('non-finite JSON constant')
try:
 root=os.path.realpath(sys.argv[1]); target=os.path.realpath(os.path.join(root,a['path']))
 if not os.path.isdir(root) or os.path.commonpath([root,target])!=root: raise ValueError('path outside task root')
 with os.fdopen(os.open(target,os.O_RDONLY|getattr(os,'O_NONBLOCK',0)),'rb') as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode): raise ValueError('not a regular file')
  if s.st_size>1048576: raise ValueError('file exceeds 1 MiB verification limit')
  b=f.read(1048577)
 if len(b)>1048576: raise ValueError('file exceeds verification limit')
 checks={'minBytes':len(b)>=a['minBytes']}
 digest=hashlib.sha256(b).hexdigest()
 if 'sha256' in a: checks['sha256']=digest==a['sha256'].lower()
 if 'mode' in a: checks['mode']=stat.S_IMODE(s.st_mode)==int(a['mode'],8)
 if a['format']!='binary' or 'expectText' in a:
  text=b.decode('utf-8')
  if 'expectText' in a: checks['expectText']=a['expectText'] in text
  if a['format']=='json': json.loads(text,parse_constant=invalid_constant); checks['syntax']=True
  if a['format']=='python': ast.parse(text,filename=target); checks['syntax']=True
 print(json.dumps({'path':target,'bytes':len(b),'sha256':digest,'mode':oct(stat.S_IMODE(s.st_mode)),'checks':checks,'passed':all(checks.values())}))
 sys.exit(0 if all(checks.values()) else 1)
except (OSError,ValueError,SyntaxError) as e:
 print(json.dumps({'passed':False,'errorType':type(e).__name__}))
 sys.exit(1)
`;

export async function executeVerification(
  core: Backend,
  target: AgentTarget,
  call: AgentToolCall,
  signal: AbortSignal,
) {
  if (target.kind !== "ssh") throw new Error("分类验收仅支持 SSH Linux 服务器");
  if (signal.aborted) throw new Error("任务已停止");
  const startedAt = new Date().toISOString();
  const a = call.arguments;
  const command =
    call.tool === "verify_file"
      ? `/usr/bin/python3 -I -S -c ${q(fileVerificationScript)} ${q(target.root)} ${q(JSON.stringify(a))}`
      : `if command -v rpm >/dev/null 2>&1; then rpm -q --qf '%{VERSION}\\n' -- ${q(String(a.name))}; elif command -v dpkg-query >/dev/null 2>&1; then dpkg-query -W -f '\${db:Status-Status}\\t\${Version}\\n' -- ${q(String(a.name))}; else echo 'No supported package manager' >&2; exit 1; fi`;
  const result = await core.ssh.exec(target.hostId, command, {
    sudo: target.sudo,
    timeout: 20000,
    raw: true,
  });
  if (signal.aborted) throw new Error("任务已停止");
  let code = result.code;
  let data: unknown;
  if (code === 0) {
    try {
      if (call.tool === "verify_file") {
        data = JSON.parse(result.stdout);
        if ((data as any).passed !== true) code = 1;
      } else {
        const lines = result.stdout.trim().split(/\r?\n/);
        const versions = lines
          .filter(
            (line) => !line.includes("\t") || line.startsWith("installed\t"),
          )
          .map((line) => (line.includes("\t") ? line.split("\t")[1] : line))
          .filter(Boolean);
        const passed =
          versions.length > 0 &&
          (!a.version || versions.includes(String(a.version)));
        data = { name: a.name, versions, passed };
        if (!passed) code = 1;
      }
    } catch {
      code = 1;
    }
  }
  return {
    code,
    data,
    stdout: result.stdout.slice(0, 8000),
    stderr: result.stderr.slice(0, 2000),
    evidence: {
      tool: call.tool,
      hostId: target.hostId,
      startedAt,
      observedAt: new Date().toISOString(),
    },
    note: "只验证本次指定断言；语法正确或包已安装不代表业务运行正确。文件验收依赖/usr/bin/python3且最大1MiB。",
  };
}
