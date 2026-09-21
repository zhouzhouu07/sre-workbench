import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Backend } from "../core/backend";
import { shellQuote as q } from "../core/safety";
import type { AgentTarget, AgentToolCall } from "../../shared/agent";
import type { Task } from "../../shared/types";
import { isMutation, parseTool, toolDecision } from "./agent-contract";
import type { AgentPermission } from "../../shared/agent";

export class UncertainExecution extends Error {}
const limit = 100000;
const stopped = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error("任务已停止");
};
export function scopedPath(root: string, value: string, remote = false) {
  const api = remote ? path.posix : path;
  const resolved = api.resolve(root, value);
  const relative = api.relative(root, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${api.sep}`) ||
    api.isAbsolute(relative) ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error("文件路径超出本次工作目录");
  if (
    !remote &&
    process.platform === "win32" &&
    (resolved.slice(2).includes(":") ||
      /(^|[\\/])(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|[\\/]|$)/i.test(
        resolved,
      ))
  )
    throw new Error("不允许设备路径或备用数据流");
  return resolved;
}
export function loopbackUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("HTTP 验证仅允许目标机器的 HTTP 回环地址，不跟随跳转");
  return url.toString();
}
export async function localScopedPath(root: string, value: string) {
  const resolved = scopedPath(root, value);
  // Check every existing ancestor. A junction/symlink may not escape the selected root.
  let ancestor = resolved;
  while (true) {
    try {
      await fs.lstat(ancestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
      continue;
    }
    // An existing dangling link is not a missing file. Never fall back to its
    // parent: a later write could otherwise follow it outside the selected root.
    const real = await fs.realpath(ancestor);
    scopedPath(root, real);
    break;
  }
  return resolved;
}
export function runLocalCommand(
  command: string,
  cwd: string,
  timeout: number,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  stopped(signal);
  if (process.platform !== "win32")
    throw new Error("本机终端当前仅支持 Windows PowerShell");
  const powershell = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\n$global:LASTEXITCODE = 0\ntry {\n${command}\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      reason = "",
      settled = false,
      killing = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, code = 1) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(fallback);
      signal.removeEventListener("abort", cancel);
      error ? reject(error) : resolve({ stdout, stderr, code });
    };
    const kill = (message: string) => {
      if (killing || settled) return;
      killing = true;
      reason = message;
      if (child.pid) {
        const killer = spawn(
          path.join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.once("error", () => child.kill());
      } else child.kill();
      fallback = setTimeout(
        () =>
          finish(
            new UncertainExecution(`${message}；进程停止结果未确认，请核实`),
          ),
        5000,
      );
    };
    const cancel = () => kill("任务已停止");
    const timer = setTimeout(() => kill("命令超时"), timeout * 1000);
    signal.addEventListener("abort", cancel, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => {
      stdout = (stdout + value).slice(-limit);
      if (stdout.length + stderr.length >= limit) kill("命令输出达到上限");
    });
    child.stderr.on("data", (value: string) => {
      stderr = (stderr + value).slice(-limit);
      if (stdout.length + stderr.length >= limit) kill("命令输出达到上限");
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) =>
      finish(reason ? new Error(reason) : undefined, code ?? 1),
    );
    if (signal.aborted) cancel();
  });
}

export class AgentTools {
  constructor(private core: Backend) {}
  async validateTarget(target: AgentTarget): Promise<AgentTarget> {
    if (target.kind === "local") {
      if (!path.isAbsolute(target.root) || target.root.startsWith("\\\\"))
        throw new Error("请选择本机绝对目录，不支持网络共享路径");
      const root = await fs.realpath(target.root);
      if (!(await fs.stat(root)).isDirectory())
        throw new Error("工作目录不存在");
      return { ...target, root };
    }
    if (!path.posix.isAbsolute(target.root) || /[\x00-\x1f]/.test(target.root))
      throw new Error("远端工作目录必须为绝对路径");
    const host = this.core.ssh.host(target.hostId);
    if (!host.fingerprint) throw new Error("请先在主机管理中核验 SSH 指纹");
    // No connection is made just to start a session. A missing remote root can be created by a mutation tool.
    return { ...target, root: path.posix.normalize(target.root) };
  }
  async execute(
    target: AgentTarget,
    permission: AgentPermission,
    input: AgentToolCall,
    approved: boolean,
    signal: AbortSignal,
    onTask: (id: string) => void,
  ) {
    const call = parseTool(input);
    const decision = toolDecision(permission, call);
    if (decision === "deny" || (decision === "confirm" && !approved))
      throw new Error("当前权限不允许此工具操作");
    stopped(signal);
    if (target.kind === "local") return this.local(target, call, signal);
    return this.remote(target, call, signal, onTask);
  }
  private async local(
    target: Extract<AgentTarget, { kind: "local" }>,
    call: AgentToolCall,
    signal: AbortSignal,
  ): Promise<unknown> {
    const a = call.arguments;
    const root = await fs.realpath(target.root);
    if (root !== target.root)
      throw new Error("工作目录指向已变化，请重新创建任务");
    if (call.tool === "inspect_system") {
      if (a.kind !== "overview")
        throw new Error(
          "本机只读系统工具仅支持 overview；进程和服务查询可在执行权限下使用终端",
        );
      return {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        shell: "Windows PowerShell 5.1",
        directory: root,
      };
    }
    if (call.tool === "run_command")
      return runLocalCommand(
        a.command as string,
        root,
        a.timeout as number,
        signal,
      );
    if (call.tool === "http_check") {
      const response = await fetch(loopbackUrl(a.url as string), {
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      let body = "";
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        try {
          while (body.length < 16000) {
            const item = await reader.read();
            if (item.done) break;
            body += decoder.decode(item.value, { stream: true });
          }
        } finally {
          await reader.cancel();
        }
      }
      return {
        code: response.ok ? 0 : 1,
        status: response.status,
        body: body.slice(0, 16000),
      };
    }
    const file = await localScopedPath(root, a.path as string);
    stopped(signal);
    if (call.tool === "list_files") {
      const items = await fs.readdir(file, { withFileTypes: true });
      return {
        entries: items.slice(0, 500).map((e) => ({
          name: e.name,
          directory: e.isDirectory(),
          link: e.isSymbolicLink(),
        })),
        truncated: items.length > 500,
      };
    }
    if (call.tool === "read_file") {
      const handle = await fs.open(file, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > limit)
          throw new Error("只能读取不超过 100 KB 的普通文件");
        return { path: file, content: await handle.readFile("utf8") };
      } finally {
        await handle.close();
      }
    }
    if (call.tool === "make_directory") {
      await fs.mkdir(file, { recursive: true });
      return { path: file, created: true };
    }
    if (call.tool === "write_file") {
      // Parent creation is explicit so approvals describe all mutations.
      await fs.writeFile(file, a.content as string, "utf8");
      return { path: file, bytes: Buffer.byteLength(a.content as string) };
    }
    throw new Error("不支持的工具");
  }
  private async remote(
    target: Extract<AgentTarget, { kind: "ssh" }>,
    call: AgentToolCall,
    signal: AbortSignal,
    onTask: (id: string) => void,
  ): Promise<unknown> {
    const a = call.arguments;
    let command: string;
    if (call.tool === "inspect_system") {
      const commands: Record<string, string> = {
        overview: "uname -a; cat /etc/os-release; uptime; free -m; df -h",
        processes: "ps aux --sort=-%cpu | head -n 80",
        services: "systemctl list-units --type=service --all --no-pager",
        containers: "docker ps -a --no-trunc",
      };
      command = commands[a.kind as string];
    } else if (call.tool === "http_check") {
      command = `curl -q --request GET --proto '=http' --noproxy '*' --silent --show-error --fail --max-time 15 --max-filesize 100000 --write-out '\\nHTTP_STATUS=%{http_code}\\n' -- ${q(loopbackUrl(a.url as string))}`;
    } else if (call.tool === "run_command") {
      command = `set -e\ncd -- ${q(target.root)} || exit 1\n${a.command}`;
    } else {
      const file = scopedPath(target.root, a.path as string, true);
      // Resolve symlinks on the server immediately before accessing the file.
      const guard = `root=$(realpath -m -- ${q(target.root)}) || exit 1\ntarget=$(realpath -m -- ${q(file)}) || exit 1\ncase "$target" in "$root"|"\${root%/}"/*) ;; *) echo '路径超出工作目录' >&2; exit 1;; esac\n`;
      if (call.tool === "list_files")
        command =
          guard +
          'test -d "$target" || { echo "目录不存在" >&2; exit 1; }; listing=$(ls -la -- "$target") || exit $?; printf "%s\\n" "$listing" | head -n 501';
      else if (call.tool === "read_file")
        command =
          guard +
          `test -f "$target" && test "$(stat -c %s -- "$target")" -le ${limit} || { echo '不是普通文件或超过100KB' >&2; exit 1; }; cat -- "$target"`;
      else if (call.tool === "make_directory")
        command = guard + 'mkdir -p -- "$target"';
      else
        command =
          guard +
          `printf %s ${q(Buffer.from(a.content as string, "utf8").toString("base64"))} | base64 -d > "$target"`;
    }
    stopped(signal);
    if (!isMutation(call)) {
      const result = await this.core.ssh.exec(target.hostId, command, {
        sudo: target.sudo,
        timeout: 20000,
        raw: true,
      });
      if (
        call.tool === "http_check" &&
        !/^HTTP_STATUS=2\d\d$/m.test(result.stdout)
      )
        result.code = result.code || 1;
      return result;
    }
    const spec = {
      hostId: target.hostId,
      title: `AI：${call.tool}`,
      script: command,
      sudo: target.sudo,
      timeout: (a.timeout as number | undefined) ?? 120,
    };
    const preview = this.core.tasks.preview(spec);
    const task = this.core.tasks.run(preview.token, spec, { source: "ai" });
    onTask(task.id);
    let cancelSent = false;
    while (true) {
      if (signal.aborted && !cancelSent) {
        cancelSent = true;
        await this.core.tasks.cancel(task.id);
      }
      const current = this.core.store.get<Task>("tasks", task.id);
      if (!current) throw new UncertainExecution("远端任务记录丢失，请核实");
      if (current.status === "unknown")
        throw new UncertainExecution(
          `远端任务 ${task.id} 状态待核实，请在本会话执行记录中核实；未自动重试`,
        );
      if (["succeeded", "failed", "cancelled"].includes(current.status)) {
        if (cancelSent || current.status === "cancelled")
          throw new Error("远端任务已停止");
        return {
          taskId: task.id,
          code: current.exitCode ?? (current.status === "succeeded" ? 0 : 1),
          stdout: current.logs.slice(-limit),
          status: current.status,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}
