// Authorized live acceptance harness. Credentials arrive through stdin only.
// Bundle with esbuild to .tools/ai-blog-live.mjs; never embed credentials here.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Backend } from "../src/main/core/backend";
import { AIService, sanitizeContext } from "../src/main/features/ai";
import { agentReplySchema } from "../src/main/features/agent-contract";
import { AgentService } from "../src/main/features/agent";
import type { AgentSession } from "../src/shared/agent";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input) as {
  address: string;
  username: string;
  password: string;
  fingerprint: string;
  apiKey: string;
  mode?: "baseline" | "run";
  project?: string;
};
input = "";
if (config.project && !/^sre-ai-blog-[a-f0-9]{8}$/.test(config.project))
  throw new Error("Invalid test project");
const runId = config.project ?? `sre-ai-blog-${randomUUID().slice(0, 8)}`;
const dataDir = resolve(".tools", runId);
await mkdir(dataDir, { recursive: true });
const originalFetch = globalThis.fetch;
let invalidCount = 0;
globalThis.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (String(args[0]).startsWith("https://api.deepseek.com") && response.ok) {
    const payload = await response.clone().json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.includes('"type"')) {
      try {
        agentReplySchema.parse(
          JSON.parse(
            content
              .trim()
              .replace(/^```(?:json)?\s*/, "")
              .replace(/\s*```$/, ""),
          ),
        );
      } catch (error) {
        const file = join(dataDir, `invalid-model-${++invalidCount}.txt`);
        await writeFile(
          file,
          sanitizeContext(content).replaceAll(config.apiKey, "[REDACTED]"),
        );
        console.log(
          "INVALID_MODEL",
          JSON.stringify({
            file,
            reason: String(error).slice(0, 1200),
            finishReason: payload?.choices?.[0]?.finish_reason,
          }),
        );
      }
    }
  }
  return response;
};
const encryptionKey = randomBytes(32); // Not persisted; secrets usable only by this process.
const encrypt = (value: string) => {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
};
const decrypt = (value: string) => {
  const bytes = Buffer.from(value, "base64"),
    cipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      bytes.subarray(0, 12),
    );
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
};
const core = new Backend({
  dataDir,
  encrypt,
  decrypt,
  emit: () => {},
  chooseFile: async () => null,
});
await core.init();
const ai = new AIService(core.store, () => {});
const agent = new AgentService(core, ai, () => {});
const controlPath = join(dataDir, "control.json");
let sessionId = "";
try {
  const host = await core.handle("host.save", {
    name: "AI blog acceptance",
    address: config.address,
    port: 22,
    username: config.username,
    authType: "password",
    password: config.password,
    group: "test",
    tags: [],
  });
  const probe = await core.handle("host.probe", { id: host.id });
  if (probe.fingerprint !== config.fingerprint)
    throw new Error(
      "SSH fingerprint mismatch; no authenticated operation attempted",
    );
  await core.handle("host.trust", {
    id: host.id,
    fingerprint: probe.fingerprint,
  });
  console.log("SSH_FINGERPRINT_MATCH");
  const baseline = await core.ssh.exec(
    host.id,
    "cat /etc/rocky-release; uname -m; uptime; free -m; df -h /; docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}'; ss -ltnH; curl -q --noproxy '*' -sS -o /dev/null -w 'NODE18084=%{http_code}\\n' --max-time 10 http://127.0.0.1:18084/",
    { raw: true },
  );
  console.log("BASELINE", baseline.stdout, baseline.stderr);
  await writeFile(
    join(dataDir, "baseline.json"),
    JSON.stringify(baseline, null, 2),
  );
  let provider: { id: string } | undefined;
  for (const baseUrl of [
    "https://api.deepseek.com",
    "https://api.deepseek.com/anthropic",
  ]) {
    const saved = await ai.handle("provider.save", {
      name: "DeepSeek live acceptance",
      kind: "model",
      protocol: "auto",
      baseUrl,
      model: "deepseek-chat",
      timeout: 180,
      apiKey: config.apiKey,
    });
    console.log(
      "MODEL_PROBE",
      JSON.stringify(await ai.handle("provider.test", { id: saved.id })),
    );
    if (!provider) provider = saved;
  }
  if (!provider) throw new Error("No model provider");
  if (config.mode === "baseline") process.exitCode = 0;
  else {
    const ports = await core.ssh.exec(host.id, "ss -ltnH", { raw: true });
    const port = Array.from({ length: 15 }, (_, i) => 18085 + i).find(
      (p) => !new RegExp(`:${p}\\s`).test(ports.stdout),
    );
    if (!port) throw new Error("No free test port");
    const root = `/opt/${runId}`;
    const instruction = `请在所选 Rocky Linux 主机的 ${root} 目录自主搭建一个简单可访问的个人博客，主题精简，使用 Python、Flask、Nginx 架构。博客只需首页和至少两篇可点开的示例文章，不需要登录、编辑后台、数据库或任何密码。生成完整项目和 README。先检查环境，使用主机已有的 Docker Compose，以独立项目名 ${runId} 部署到端口 ${port}（该端口已初步检查空闲，仍需你部署前核实），Nginx 反代 Flask，Flask 使用生产 WSGI 服务。优先复用主机已有的官方 Python/Nginx 镜像，缺少时可拉取。先创建工作目录再写文件。不得停止或替换已有应用、旧监控和 18084 服务，不删除数据卷，不执行全局 Docker 清理，不重置账号，不修改防火墙或 SELinux，不整机更新。所有本项目资源使用该独立项目前缀。可在本项目中安装依赖、创建配置、构建、启动和修正失败步骤。完成后使用 HTTP 工具确认首页为 200，再验证文章链接，报告项目路径、访问地址和实际验证步骤。只读查询状态不要改变其他服务。请自行选择合理简洁样式和示例文章内容，不必为这些普通选择追问。`;
    const started = (await agent.handle("ai.session.start", {
      providerId: provider.id,
      permission: "autonomous",
      target: { kind: "ssh", hostId: host.id, root, sudo: false },
      instruction,
      maxSteps: 50,
    })) as AgentSession;
    sessionId = started.id;
    await writeFile(
      join(dataDir, "run.json"),
      JSON.stringify({ runId, sessionId, root, port, controlPath }, null, 2),
    );
    console.log(
      "RUN",
      JSON.stringify({ runId, sessionId, root, port, controlPath }),
    );
    let previous = "";
    const deadline = Date.now() + 40 * 60 * 1000;
    while (Date.now() < deadline) {
      const current = (await agent.handle("ai.session.get", {
        id: sessionId,
      })) as AgentSession;
      const state = JSON.stringify({
        status: current.status,
        summary: current.summary,
        steps: current.steps.map((s) => ({
          id: s.id,
          status: s.status,
          tool: s.call?.tool,
          summary: s.summary,
          output: s.output?.slice(-2500),
          taskId: s.taskId,
        })),
      });
      if (state !== previous) {
        console.log(
          "PROGRESS",
          JSON.stringify({
            status: current.status,
            summary: current.summary,
            count: current.steps.length,
            last: current.steps.at(-1)
              ? {
                  ...current.steps.at(-1),
                  call: { tool: current.steps.at(-1)?.call?.tool },
                  output: current.steps.at(-1)?.output?.slice(-1800),
                }
              : null,
          }),
        );
        previous = state;
        await writeFile(
          join(dataDir, "session.json"),
          JSON.stringify(current, null, 2),
        );
      }
      if (
        ["completed", "failed", "cancelled", "unknown"].includes(current.status)
      ) {
        console.log(
          "FINAL",
          JSON.stringify({
            status: current.status,
            summary: current.summary,
            verification: current.verification,
          }),
        );
        if (current.status !== "completed") process.exitCode = 1;
        break;
      }
      try {
        const control = JSON.parse(await readFile(controlPath, "utf8"));
        await unlink(controlPath);
        if (control.action === "stop")
          await agent.handle("ai.session.stop", { id: sessionId });
        if (control.action === "reply" && current.status === "awaiting_input")
          await agent.handle("ai.session.reply", {
            id: sessionId,
            instruction: control.instruction,
          });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const current = (await agent.handle("ai.session.get", {
      id: sessionId,
    })) as AgentSession;
    if (
      ["running", "awaiting_approval", "awaiting_input"].includes(
        current.status,
      )
    ) {
      await agent.handle("ai.session.stop", { id: sessionId });
      process.exitCode = 1;
      console.log("HARNESS_DEADLINE");
    }
    const result = await core.ssh.exec(
      host.id,
      `docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}'; curl -q --noproxy '*' -sS --max-time 15 -o /dev/null -w 'NODE18084=%{http_code}\\n' http://127.0.0.1:18084/; curl -q --noproxy '*' -sS --max-time 15 -w '\\nBLOG_HTTP=%{http_code}\\n' http://127.0.0.1:${port}/`,
      { raw: true },
    );
    console.log("INDEPENDENT_HTTP", JSON.stringify(result));
    await writeFile(
      join(dataDir, "verification.json"),
      JSON.stringify(result, null, 2),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("LIVE_ERROR", message.replaceAll(config.apiKey, "[REDACTED]"));
  process.exitCode = 1;
} finally {
  await agent.close();
  ai.close();
  await core.close();
  encryptionKey.fill(0);
  config.apiKey = "";
  config.password = "";
}
