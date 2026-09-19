import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, posix, isAbsolute } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { z } from "zod";
import type { Client } from "ssh2";
import type { Backend } from "../core/backend";
import type {
  DeploymentSpec,
  DeploymentPreflightReport,
  DeploymentRelease,
  MonitoringStack,
  Task,
  ExecutionSpec,
  Host,
} from "../../shared/types";
import { shellQuote as q } from "../core/safety";
import { stageSource, validateGitURL } from "./source";
import {
  deploymentBase,
  deploymentFiles,
  deploymentScript,
} from "./deployment";
import {
  monitorBase,
  monitoringFiles,
  monitoringScript,
  exporterScript,
} from "./monitoring";
import {
  installDocker,
  environmentPreflight,
  deploymentPreflightScript,
  parseDeploymentPreflight,
} from "./environment";
import { identifier, idParams, deploySchema, monitorSchema } from "./schemas";

type SavedDeployment = DeploymentSpec & { envCredentialId?: string };
type SavedMonitor = MonitoringStack & { webhookCredentialId?: string };
type SavedRelease = DeploymentRelease & { spec: DeploymentSpec };
interface Options {
  gitPath: string;
  tempDir: string;
  openExternal: (url: string) => Promise<void>;
}
interface Approval {
  digest: string;
  expires: number;
  releaseId: string;
  script: string;
  stage: string;
}
const digest = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");

export class FeatureService {
  private approvals = new Map<string, Approval>();
  private tunnels = new Map<
    string,
    { server: Server; client: Client; sockets: Set<Socket>; url: string }
  >();
  private stopped = false;
  constructor(
    private core: Backend,
    private options: Options,
  ) {}
  async handle(method: string, params: unknown): Promise<any> {
    if (method === "deployment.delete" || method === "monitoring.delete") {
      const { id } = idParams.parse(params);
      const monitoring = method === "monitoring.delete";
      const saved = monitoring ? this.monitor(id) : this.deployment(id);
      const hostIds = [
        saved.hostId,
        ...("targets" in saved ? saved.targets.map((t) => t.hostId) : []),
      ];
      if (this.core.tasks.hasPendingWork(hostIds))
        throw new Error(
          "相关主机仍有未完成、待核实或正在收尾的任务，请稍后删除",
        );
      const secrets = monitoring
        ? [
            (saved as SavedMonitor).smtpCredentialId,
            (saved as SavedMonitor).grafanaCredentialId,
            (saved as SavedMonitor).webhookCredentialId,
          ]
        : [
            (saved as SavedDeployment).envCredentialId,
            (saved as SavedDeployment).gitCredentialId,
          ];
      if (monitoring) {
        for (const [key, tunnel] of this.tunnels)
          if (key.startsWith(id + ":")) {
            for (const socket of tunnel.sockets) socket.destroy();
            tunnel.server.close();
            tunnel.client.end();
            this.tunnels.delete(key);
          }
      } else {
        for (const release of this.core.store.list<DeploymentRelease>(
          "releases",
        ))
          if (release.deploymentId === id)
            this.core.store.remove("releases", release.id);
      }
      this.core.store.remove(monitoring ? "monitoring" : "deployments", id);
      for (const secret of secrets)
        if (secret) this.core.store.deleteSecret(secret);
      return true;
    }
    if (method === "deployment.save") return this.saveDeployment(params);
    if (method === "monitoring.save") return this.saveMonitoring(params);
    if (method === "deployment.detect") return this.detect(params);
    if (method === "deployment.preflight") {
      const p = idParams
        .extend({ releaseId: identifier.optional() })
        .strict()
        .parse(params);
      const saved = this.deployment(p.id);
      const release = p.releaseId
        ? this.core.store.get<SavedRelease>("releases", p.releaseId)
        : undefined;
      if (
        p.releaseId &&
        (!release ||
          release.deploymentId !== saved.id ||
          !["succeeded", "active"].includes(release.status))
      )
        throw new Error("该版本不可回退");
      return this.inspectDeployment(release?.spec ?? saved);
    }
    if (
      method === "deployment.preview" ||
      method === "deployment.rollback.preview"
    )
      return this.previewDeployment(params, method.includes("rollback"));
    if (method === "deployment.run" || method === "deployment.rollback.run")
      return this.runDeployment(params, method.includes("rollback"));
    if (method === "deployment.refresh") {
      const { id } = idParams.parse(params);
      await this.syncReleases(id);
      return true;
    }
    if (method === "monitoring.preview") return this.previewMonitoring(params);
    if (method === "monitoring.run") return this.runMonitoring(params);
    if (method === "monitoring.open") return this.openMonitoring(params);
    if (method === "monitoring.status") {
      const { id } = idParams.parse(params);
      const s = this.monitor(id);
      return {
        targets: await this.monitorApi(s, 9090, "/api/v1/targets"),
        alerts: await this.monitorApi(s, 9093, "/api/v2/alerts"),
        silences: await this.monitorApi(s, 9093, "/api/v2/silences"),
      };
    }
    if (method === "monitoring.test") {
      const { id } = idParams.parse(params);
      return this.monitorApi(this.monitor(id), 9093, "/api/v2/alerts", [
        {
          labels: { alertname: "SREWorkbenchTest", severity: "info" },
          annotations: { summary: "SRE 工作台测试告警" },
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 300000).toISOString(),
        },
      ]);
    }
    if (method === "monitoring.silence") {
      const p = z
        .object({
          id: identifier,
          alertname: z.string().min(1).max(200),
          minutes: z.number().int().min(1).max(10080),
          comment: z.string().min(1).max(1000),
        })
        .strict()
        .parse(params);
      return this.monitorApi(this.monitor(p.id), 9093, "/api/v2/silences", {
        matchers: [
          {
            name: "alertname",
            value: p.alertname,
            isRegex: false,
            isEqual: true,
          },
        ],
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + p.minutes * 60000).toISOString(),
        createdBy: "SRE Workbench",
        comment: p.comment,
      });
    }
    throw new Error("不支持的部署/监控操作：" + method);
  }
  private host(id: string): Host {
    return this.core.ssh.host(id);
  }
  private deployment(id: string): SavedDeployment {
    const s = this.core.store.get<SavedDeployment>("deployments", id);
    if (!s) throw new Error("部署方案不存在");
    return s;
  }
  private monitor(id: string): SavedMonitor {
    const s = this.core.store.get<SavedMonitor>("monitoring", id);
    if (!s) throw new Error("监控方案不存在");
    return s;
  }
  private fullDeployment(s: SavedDeployment): DeploymentSpec {
    return {
      ...s,
      env: s.envCredentialId
        ? JSON.parse(this.core.store.getSecret(s.envCredentialId) || "{}")
        : s.env,
    };
  }
  private fullMonitor(s: SavedMonitor): MonitoringStack {
    return {
      ...s,
      webhook: s.webhookCredentialId
        ? this.core.store.getSecret(s.webhookCredentialId) || ""
        : "",
    };
  }
  private saveDeployment(params: unknown) {
    const clean = { ...(params as Record<string, unknown>) };
    delete clean.envCredentialId;
    const p = deploySchema.parse(clean);
    this.host(p.hostId);
    const old = p.id ? this.deployment(p.id) : undefined;
    if (
      old &&
      old.hostId !== p.hostId &&
      this.core.store
        .list<DeploymentRelease>("releases")
        .some((r) => r.deploymentId === old.id)
    )
      throw new Error("已有发布版本的方案不能更换主机，请新建方案");
    if (p.sourceType === "git") validateGitURL(p.source);
    else if (!isAbsolute(p.source)) throw new Error("本地源码必须是绝对路径");
    if (
      p.template !== "dockerfile" &&
      !/^(?:20|22|20\.19\.0|22\.14\.0|3\.11|3\.12|3\.11\.11|3\.12\.9)$/.test(
        p.runtime,
      )
    )
      throw new Error("请选择 Node 22.14.0/20.19.0 或 Python 3.12.9/3.11.11");
    if (p.template === "python" && !p.runtime.startsWith("3."))
      throw new Error("Python 模板需要 Python 运行时版本");
    if (["node", "static"].includes(p.template) && p.runtime.startsWith("3."))
      throw new Error("Node 模板需要 Node 运行时版本");
    if (["node", "python"].includes(p.template) && !p.startCommand.trim())
      throw new Error("请填写启动命令");
    const previous = old ? this.fullDeployment(old).env : {};
    const env = Object.fromEntries(
      Object.entries(p.env).map(([k, v]) => [
        k,
        v === "[REDACTED]" ? (previous[k] ?? "") : v,
      ]),
    );
    const envCredentialId = this.core.store.setSecret(
      JSON.stringify(env),
      old?.envCredentialId,
    );
    const gitCredentialId = p.gitToken
      ? this.core.store.setSecret(p.gitToken, old?.gitCredentialId)
      : old?.gitCredentialId;
    const { gitToken, ...rest } = p;
    const saved: SavedDeployment = {
      ...rest,
      id: p.id ?? randomUUID(),
      env: Object.fromEntries(Object.keys(env).map((k) => [k, "[REDACTED]"])),
      envCredentialId,
      gitCredentialId,
    };
    this.core.store.put("deployments", saved);
    return saved;
  }
  private saveMonitoring(params: unknown) {
    const clean = { ...(params as Record<string, unknown>) };
    delete clean.webhookCredentialId;
    const p = monitorSchema.parse(clean);
    this.host(p.hostId);
    for (const t of p.targets) {
      this.host(t.hostId);
      if (t.address === "0.0.0.0" || t.address.startsWith("127."))
        throw new Error("采集地址必须是主机间可达的内网 IP");
    }
    if (new Set(p.targets.map((t) => t.hostId)).size !== p.targets.length)
      throw new Error("同一主机不能重复出现在采集目标中");
    const old = p.id ? this.monitor(p.id) : undefined;
    if (old && old.hostId !== p.hostId)
      throw new Error("请新建方案来更换监控服务器");
    if (
      this.core.store
        .list<MonitoringStack>("monitoring")
        .some((m) => m.hostId === p.hostId && m.id !== p.id)
    )
      throw new Error("每台监控服务器首版只能部署一套监控");
    if (
      (!old && !p.grafanaPassword) ||
      (p.grafanaPassword && p.grafanaPassword.length < 12)
    )
      throw new Error("首次部署需要至少 12 位 Grafana 管理员密码");
    if ((p.smtpEnabled ?? !!p.smtpHost) && (!p.smtpFrom || !p.smtpTo))
      throw new Error("邮件通知需要发件地址和收件地址");
    let webhook = p.webhook;
    if (webhook === "[REDACTED]")
      webhook = old ? this.fullMonitor(old).webhook : "";
    if (webhook) {
      const u = new URL(webhook);
      if (u.protocol !== "https:" || u.username || u.password)
        throw new Error("Webhook 需要不含用户名密码的 HTTPS URL");
    }
    const smtpCredentialId = p.smtpPassword
      ? this.core.store.setSecret(p.smtpPassword, old?.smtpCredentialId)
      : old?.smtpCredentialId;
    const grafanaCredentialId = p.grafanaPassword
      ? this.core.store.setSecret(p.grafanaPassword, old?.grafanaCredentialId)
      : old?.grafanaCredentialId;
    const webhookCredentialId = webhook
      ? this.core.store.setSecret(webhook, old?.webhookCredentialId)
      : undefined;
    const { smtpPassword, grafanaPassword, ...rest } = p;
    const saved: SavedMonitor = {
      ...rest,
      id: p.id ?? randomUUID(),
      smtpCredentialId,
      grafanaCredentialId,
      webhookCredentialId,
      webhook: webhook ? "[REDACTED]" : "",
    };
    this.core.store.put("monitoring", saved);
    return saved;
  }
  private async detect(params: unknown) {
    const p = z
      .object({
        path: z.string().min(1),
        template: z.enum(["node", "static", "python", "dockerfile"]),
      })
      .strict()
      .parse(params);
    if (!isAbsolute(p.path)) throw new Error("请选择绝对项目目录");
    if (p.template === "python") {
      await readFile(join(p.path, "requirements.txt"), "utf8");
      return {
        runtime: "3.12.9",
        installCommand: "pip install --no-cache-dir -r requirements.txt",
        containerPort: 8000,
        startCommand: "python app.py",
      };
    }
    if (p.template === "dockerfile") {
      await readFile(join(p.path, "Dockerfile"), "utf8");
      return { template: "dockerfile" };
    }
    const pkg = JSON.parse(
      await readFile(join(p.path, "package.json"), "utf8"),
    );
    const scripts = pkg.scripts ?? {};
    let lock = false;
    try {
      await readFile(join(p.path, "package-lock.json"));
      lock = true;
    } catch {}
    return {
      runtime: "22.14.0",
      installCommand: lock ? "npm ci" : "npm install",
      buildCommand: typeof scripts.build === "string" ? "npm run build" : "",
      startCommand:
        typeof scripts.start === "string" ? "npm start" : "node server.js",
      outputDir: "dist",
      containerPort: p.template === "static" ? 80 : 3000,
    };
  }
  private approvalKey(
    kind: string,
    s: SavedDeployment | SavedMonitor,
    releaseId?: string,
  ) {
    const hosts = [
      this.host(s.hostId),
      ...("targets" in s ? s.targets.map((t) => this.host(t.hostId)) : []),
    ];
    const secretContent =
      "targets" in s ? this.fullMonitor(s) : this.fullDeployment(s);
    const secretRefs =
      "targets" in s
        ? [s.smtpCredentialId, s.grafanaCredentialId]
        : [s.gitCredentialId];
    return digest({
      kind,
      s,
      secretContent,
      hosts,
      releaseId,
      secretValues: secretRefs.map((id) =>
        id ? this.core.store.getSecret(id) : undefined,
      ),
    });
  }
  private issue(key: string, releaseId: string, script: string, stage: string) {
    for (const [k, v] of this.approvals)
      if (v.expires < Date.now()) this.approvals.delete(k);
    if (this.approvals.size > 100)
      throw new Error("未确认操作过多，请完成或重启应用");
    const token = randomUUID();
    this.approvals.set(token, {
      digest: key,
      expires: Date.now() + 600000,
      releaseId,
      script,
      stage,
    });
    return token;
  }
  private consume(token: string, key: string) {
    const a = this.approvals.get(token);
    this.approvals.delete(token);
    if (!a || a.expires < Date.now() || a.digest !== key)
      throw new Error("配置或目标主机已改变，请重新预览确认");
    return a;
  }
  private previewDeployment(params: unknown, rollback: boolean) {
    const p = (
      rollback ? idParams.extend({ releaseId: identifier }).strict() : idParams
    ).parse(params) as { id: string; releaseId?: string };
    const s = this.deployment(p.id);
    if (!this.host(s.hostId).fingerprint)
      throw new Error("请先连接并信任目标主机");
    let spec: DeploymentSpec = s;
    let releaseId: string = randomUUID();
    if (rollback) {
      const release = this.core.store.get<SavedRelease>(
        "releases",
        p.releaseId!,
      );
      if (
        !release ||
        release.deploymentId !== s.id ||
        !["succeeded", "active"].includes(release.status)
      )
        throw new Error("该版本不可回退");
      spec = release.spec;
      releaseId = release.id;
    }
    const stage = "/tmp/sre-stage-" + randomUUID();
    const script =
      installDocker + "\n" + deploymentScript(spec, releaseId, stage, rollback);
    const token = this.issue(
      this.approvalKey(rollback ? "rollback" : "deploy", s, p.releaseId),
      releaseId,
      script,
      stage,
    );
    return {
      token,
      script,
      summary: `${this.host(s.hostId).name} · ${rollback ? "回退" : "部署"} ${s.name}。以 root 执行；按需安装 Docker；上传源码与已保存的环境变量；健康检查后切换入口。不会迁移数据库。`,
    };
  }
  private async runDeployment(params: unknown, rollback: boolean) {
    const p = z
      .object({
        id: identifier,
        token: z.string(),
        ...(rollback ? { releaseId: identifier } : {}),
      })
      .strict()
      .parse(params) as { id: string; token: string; releaseId?: string };
    const s = this.deployment(p.id);
    const a = this.consume(
      p.token,
      this.approvalKey(rollback ? "rollback" : "deploy", s, p.releaseId),
    );
    const full = this.fullDeployment(s);
    const targetSpec = rollback
      ? this.core.store.get<SavedRelease>("releases", p.releaseId!)!.spec
      : s;
    const spec: ExecutionSpec = {
      hostId: s.hostId,
      title: `${rollback ? "回退" : "部署"} ${s.name}`,
      script: a.script,
      sudo: true,
      timeout: 3600,
    };
    const accepted = this.core.tasks.preview(spec);
    const task = this.core.tasks.run(accepted.token, spec, {
      prepare: async (task) => {
        const report = await this.inspectDeployment(targetSpec);
        if (!report.ready)
          throw new Error(
            "部署环境预检失败：" +
              report.checks
                .filter((c) => c.status === "fail")
                .map((c) => c.detail)
                .join("；"),
          );
        if (rollback) return;
        const staged = await stageSource(
          full,
          this.options,
          s.gitCredentialId
            ? this.core.store.getSecret(s.gitCredentialId)
            : undefined,
        );
        try {
          this.assertActive(task.id);
          await this.stageDirectory(s.hostId, a.stage);
          await this.remoteDirectory(s.hostId, a.stage + "/source");
          for (const file of staged.files) {
            this.assertActive(task.id);
            const remote = a.stage + "/source/" + file.relative;
            await this.remoteDirectory(s.hostId, posix.dirname(remote));
            await this.core.ssh.upload(s.hostId, file.path, remote);
          }
          for (const [path, content] of Object.entries(
            deploymentFiles(full, a.releaseId),
          )) {
            this.assertActive(task.id);
            await this.remoteDirectory(
              s.hostId,
              posix.dirname(a.stage + "/" + path),
            );
            await this.core.ssh.write(s.hostId, a.stage + "/" + path, content);
          }
        } finally {
          await staged.cleanup();
        }
      },
      after: async () => {
        try {
          await this.syncReleases(s.id);
        } finally {
          await this.removeStage(s.hostId, a.stage);
        }
      },
    });
    if (!rollback)
      this.core.store.put("releases", {
        id: a.releaseId,
        deploymentId: s.id,
        taskId: task.id,
        createdAt: new Date().toISOString(),
        image: "sre-" + s.id + ":" + a.releaseId,
        status: "queued",
        spec: { ...s },
      } satisfies SavedRelease);
    return task;
  }
  async syncReleases(id: string) {
    const s = this.deployment(id);
    const base = deploymentBase(id);
    const result = await this.core.ssh.exec(
      s.hostId,
      `if test -d ${q(base)}; then printf 'CURRENT='; cat ${q(base + "/current")} 2>/dev/null || true; printf '\n'; find ${q(base + "/releases")} -mindepth 2 -maxdepth 2 -name success -printf '%h\n' 2>/dev/null; fi`,
      { sudo: true, raw: true },
    );
    if (result.code !== 0)
      throw new Error(
        "无法核实远端版本：" + this.core.store.redact(result.stderr),
      );
    const active = result.stdout.match(/CURRENT=([0-9a-f-]+)/)?.[1];
    for (const r of this.core.store
      .list<SavedRelease>("releases")
      .filter((r) => r.deploymentId === id)) {
      const exists = result.stdout
        .split("\n")
        .includes(base + "/releases/" + r.id);
      const task = this.core.store.get<Task>("tasks", r.taskId);
      this.core.store.put("releases", {
        ...r,
        status:
          r.id === active
            ? "active"
            : exists
              ? "succeeded"
              : task?.status === "succeeded"
                ? "pruned"
                : (task?.status ?? r.status),
      });
    }
  }
  private previewMonitoring(params: unknown) {
    const { id } = idParams.parse(params);
    const s = this.monitor(id);
    for (const hostId of new Set([s.hostId, ...s.targets.map((t) => t.hostId)]))
      if (!this.host(hostId).fingerprint)
        throw new Error("请先信任所有监控目标的 SSH 指纹");
    const stage = "/tmp/sre-stage-" + randomUUID();
    const script =
      s.targets
        .map(
          (t) =>
            `# 主机 ${this.host(t.hostId).name}\n${installDocker}\n${exporterScript(t.hostId, t.address)}`,
        )
        .join("\n\n") +
      `\n# 监控服务器 ${this.host(s.hostId).name}\n${installDocker}\n${monitoringScript(s, stage)}`;
    const token = this.issue(
      this.approvalKey("monitor", s),
      randomUUID(),
      script,
      stage,
    );
    return {
      token,
      script,
      summary: `安装/更新 ${s.targets.length} 台主机的 Node Exporter 和监控服务器。root 执行；按需安装 Docker；密钥以受限文件写入；保留监控卷，备份原配置。`,
    };
  }
  private runMonitoring(params: unknown) {
    const { id, token } = idParams
      .extend({ token: z.string() })
      .strict()
      .parse(params);
    const s = this.monitor(id);
    const a = this.consume(token, this.approvalKey("monitor", s));
    const exporters: Task[] = [];
    for (const t of s.targets) {
      const spec: ExecutionSpec = {
        hostId: t.hostId,
        title: `安装指标采集：${this.host(t.hostId).name}`,
        script: installDocker + "\n" + exporterScript(t.hostId, t.address),
        sudo: true,
        timeout: 1800,
      };
      const p = this.core.tasks.preview(spec);
      exporters.push(
        this.core.tasks.run(p.token, spec, {
          prepare: async () => {
            await this.preflight(t.hostId);
            await this.checkPorts(t.hostId, [9100], "sre-node-exporter");
          },
        }),
      );
    }
    const spec: ExecutionSpec = {
      hostId: s.hostId,
      title: `部署监控：${s.name}`,
      script: installDocker + "\n" + monitoringScript(s, a.stage),
      sudo: true,
      timeout: 1800,
    };
    const p = this.core.tasks.preview(spec);
    const task = this.core.tasks.run(p.token, spec, {
      dependencyIds: exporters.map((t) => t.id),
      prepare: async (task) => {
        const start = Date.now();
        while (true) {
          this.assertActive(task.id);
          const states = exporters.map((t) =>
            this.core.store.get<Task>("tasks", t.id)!,
          );
          if (
            states.some((t) =>
              ["failed", "cancelled", "unknown"].includes(t.status),
            )
          )
            throw new Error("指标采集安装失败或状态待核实，请先查看对应任务");
          if (states.every((t) => t.status === "succeeded")) break;
          if (Date.now() - start > 1800000) throw new Error("等待采集组件超时");
          await new Promise((r) => setTimeout(r, 1000));
        }
        await this.preflight(s.hostId);
        await this.checkPorts(s.hostId, [3000, 9090, 9093], "sre-mon-" + s.id);
        await this.stageDirectory(s.hostId, a.stage);
        const files = monitoringFiles(
          this.fullMonitor(s),
          s.smtpCredentialId
            ? this.core.store.getSecret(s.smtpCredentialId) || ""
            : "",
          s.grafanaCredentialId
            ? this.core.store.getSecret(s.grafanaCredentialId) || ""
            : "",
        );
        for (const [path, content] of Object.entries(files)) {
          this.assertActive(task.id);
          await this.remoteDirectory(
            s.hostId,
            posix.dirname(a.stage + "/" + path),
          );
          await this.core.ssh.write(s.hostId, a.stage + "/" + path, content);
        }
      },
      after: async () => this.removeStage(s.hostId, a.stage),
    });
    return [...exporters, task];
  }
  private assertActive(taskId: string) {
    const t = this.core.store.get<any>("tasks", taskId);
    if (this.stopped || !t || t.cancelRequested || t.status === "cancelled")
      throw new Error("任务已取消");
  }
  private async inspectDeployment(
    s: DeploymentSpec,
  ): Promise<DeploymentPreflightReport> {
    const report: DeploymentPreflightReport = {
      deploymentId: s.id,
      hostId: s.hostId,
      checkedAt: new Date().toISOString(),
      ready: false,
      checks: [],
    };
    try {
      const result = await this.core.ssh.exec(
        s.hostId,
        deploymentPreflightScript(s),
        { sudo: true, raw: true, timeout: 30000 },
      );
      if (result.code !== 0)
        throw new Error(
          result.stderr || result.stdout || "SSH/root/sudo 检查失败",
        );
      report.checks = parseDeploymentPreflight(result.stdout).map((check) => ({
        ...check,
        detail: this.core.store.redact(check.detail),
      }));
      const ports = s.domain ? [80, 443] : [s.publicPort];
      if (
        (s.domain && !report.checks.some((c) => c.id === "port-443-udp")) ||
        !ports.every((p) => report.checks.some((c) => c.id === "port-" + p)) ||
        !s.volumes.every((_, i) =>
          report.checks.some((c) => c.id === "volume-" + i),
        )
      )
        throw new Error("环境预检缺少端口或挂载检查");
      report.ready = !report.checks.some((c) => c.status === "fail");
    } catch (error) {
      report.checks.push({
        id: "connection",
        status: "fail",
        detail: this.core.store.redact(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
    return report;
  }
  private async preflight(hostId: string) {
    const r = await this.core.ssh.exec(hostId, environmentPreflight, {
      sudo: true,
      raw: true,
    });
    if (r.code !== 0)
      throw new Error(
        this.core.store.redact(r.stderr || r.stdout || "Linux 环境预检失败"),
      );
  }
  private async checkPorts(hostId: string, ports: number[], project: string) {
    const script = `set -eu\ncommand -v ss >/dev/null\nfor port in ${ports.join(" ")}; do\n occupied=$(ss -H -ltn "sport = :$port" 2>/dev/null || true)\n if test -n "$occupied"; then\n  command -v docker >/dev/null || { echo "Port occupied: $port" >&2; exit 1; }\n  ${project === "sre-node-exporter" ? `test -n "$(docker ps -q --filter ${q("label=com.docker.compose.project=" + project)})" && continue` : ":"}\n  found=$(docker ps --filter ${q("label=com.docker.compose.project=" + project)} --format '{{.Ports}}')\n  printf '%s' "$found" | grep -q ":$port->" || { echo "Port occupied by unmanaged service: $port" >&2; exit 1; }\n fi\ndone`;
    const r = await this.core.ssh.exec(hostId, script, {
      sudo: true,
      raw: true,
    });
    if (r.code !== 0)
      throw new Error(this.core.store.redact(r.stderr || "端口冲突"));
  }
  private async stageDirectory(hostId: string, path: string) {
    if (!/^\/tmp\/sre-stage-[0-9a-f-]{36}$/.test(path))
      throw new Error("暂存路径无效");
    const r = await this.core.ssh.exec(
      hostId,
      `umask 077; mkdir -m 700 -- ${q(path)}`,
      { raw: true },
    );
    if (r.code !== 0) throw new Error("无法创建隔离的远端暂存目录");
  }
  private async remoteDirectory(hostId: string, path: string) {
    const r = await this.core.ssh.exec(
      hostId,
      `umask 077; mkdir -p -- ${q(path)}`,
      { raw: true },
    );
    if (r.code !== 0) throw new Error("无法创建远端目录");
  }
  private async removeStage(hostId: string, path: string) {
    if (!/^\/tmp\/sre-stage-[0-9a-f-]{36}$/.test(path)) return;
    await this.core.ssh.exec(hostId, `rm -rf -- ${q(path)}`);
  }
  private async monitorApi(
    s: MonitoringStack,
    port: number,
    path: string,
    body?: unknown,
  ) {
    const encoded =
      body === undefined
        ? undefined
        : Buffer.from(JSON.stringify(body)).toString("base64");
    const cmd = encoded
      ? `printf %s ${q(encoded)} | base64 -d | curl -fsS --max-time 20 -H 'Content-Type: application/json' -X POST --data-binary @- ${q(`http://127.0.0.1:${port}${path}`)}`
      : `curl -fsS --max-time 20 ${q(`http://127.0.0.1:${port}${path}`)}`;
    const r = await this.core.ssh.exec(s.hostId, cmd, { raw: true });
    if (r.code !== 0)
      throw new Error("监控 API 失败：" + this.core.store.redact(r.stderr));
    const redactValues = (value: unknown): unknown => {
      if (typeof value === "string") return this.core.store.redact(value);
      if (Array.isArray(value)) return value.map(redactValues);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, redactValues(item)]),
        );
      return value;
    };
    return r.stdout.trim() ? redactValues(JSON.parse(r.stdout)) : true;
  }
  private async openMonitoring(params: unknown) {
    const { id, service } = idParams
      .extend({ service: z.enum(["grafana", "prometheus", "alertmanager"]) })
      .strict()
      .parse(params);
    const s = this.monitor(id);
    const key = id + ":" + service;
    const existing = this.tunnels.get(key);
    if (existing) {
      await this.options.openExternal(existing.url);
      return existing.url;
    }
    const remotePort = { grafana: 3000, prometheus: 9090, alertmanager: 9093 }[
      service
    ];
    const client = await this.core.ssh.connect(s.hostId);
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.on("close", () => sockets.delete(socket));
      client.forwardOut(
        "127.0.0.1",
        socket.remotePort ?? 0,
        "127.0.0.1",
        remotePort,
        (error, stream) => {
          if (error) {
            socket.destroy();
            return;
          }
          stream.on("error", () => socket.destroy());
          socket.pipe(stream).pipe(socket);
          socket.on("close", () => stream.destroy());
        },
      );
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("SSH 隧道创建失败");
      const url = `http://127.0.0.1:${address.port}${service === "grafana" ? "/d/sre-nodes" : "/"}`;
      const close = () => {
        server.close();
        for (const socket of sockets) socket.destroy();
        this.tunnels.delete(key);
      };
      client.once("close", close);
      server.on("error", () => {
        close();
        client.end();
      });
      this.tunnels.set(key, { server, client, sockets, url });
      await this.options.openExternal(url);
      return url;
    } catch (error) {
      server.close();
      client.end();
      throw error;
    }
  }
  close() {
    this.stopped = true;
    for (const t of this.tunnels.values()) {
      for (const socket of t.sockets) socket.destroy();
      t.server.close();
      t.client.end();
    }
    this.tunnels.clear();
  }
}
