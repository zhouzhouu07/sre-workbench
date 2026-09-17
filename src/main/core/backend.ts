import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type {
  AppEvent,
  Host,
  HostInput,
  ScriptVersion,
  Task,
} from "../../shared/types";
import { Store } from "./store";
import { SSHManager } from "./ssh";
import { TaskManager } from "./tasks";
import { shellQuote as q } from "./safety";
import { metricsCommand } from "./metrics";

const id = z.string().min(1).max(100),
  text = z.string().min(1).max(200);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (p) => p.startsWith("/") && !p.includes("\0"),
    "必须使用绝对远程路径",
  );
const hostId = { hostId: id };
const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const spec = object({
  ...hostId,
  title: text,
  script: z
    .string()
    .min(1)
    .max(500000)
    .refine((s) => !s.includes("\0")),
  sudo: z.boolean(),
  timeout: z.number().int().min(1).max(86400),
});
const hostSchema = object({
  id: id.optional(),
  name: text,
  address: z
    .string()
    .min(1)
    .max(253)
    .refine((s) => !/[\s\x00-\x1f/]/.test(s), "无效地址"),
  port: z.number().int().min(1).max(65535),
  username: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/),
  group: z.string().max(100).default(""),
  tags: z.array(z.string().max(50)).max(30).default([]),
  authType: z.enum(["password", "key"]),
  password: z.string().max(10000).optional(),
  privateKey: z.string().max(100000).optional(),
  passphrase: z.string().max(10000).optional(),
  sudoPassword: z.string().max(10000).optional(),
});
const unit = z
  .string()
  .regex(/^[a-zA-Z0-9_@.:-]+$/)
  .max(200);
export interface BackendOptions {
  dataDir: string;
  encrypt: (s: string) => string;
  decrypt: (s: string) => string;
  emit: (e: AppEvent) => void;
  chooseFile: (mode: "file" | "directory" | "save") => Promise<string | null>;
}
export class Backend {
  readonly store: Store;
  readonly ssh: SSHManager;
  readonly tasks: TaskManager;
  private probes = new Map<
    string,
    { fingerprint: string; identity: string; expires: number }
  >();
  private selectedFiles = new Map<string, "file" | "directory" | "save">();
  constructor(private options: BackendOptions) {
    this.store = new Store(options.dataDir, options.encrypt, options.decrypt);
    this.ssh = new SSHManager(this.store, options.emit);
    this.tasks = new TaskManager(this.store, this.ssh, options.emit);
  }
  async init(): Promise<void> {
    await this.store.init();
    this.tasks.init();
  }
  private changed(): void {
    this.options.emit({ type: "changed" });
  }
  private saveHost(input: HostInput): Host {
    const old = input.id ? this.store.get<Host>("hosts", input.id) : undefined;
    if (input.id && !old) throw new Error("主机不存在");
    const existing: Record<string, string> = old
      ? JSON.parse(this.store.getSecret(old.credentialId) || "{}")
      : {};
    const credential = { ...existing };
    for (const name of [
      "password",
      "privateKey",
      "passphrase",
      "sudoPassword",
    ] as const)
      if (input[name] !== undefined && input[name] !== "")
        credential[name] = input[name]!;
    if (
      (input.authType === "password" && !credential.password) ||
      (input.authType === "key" && !credential.privateKey)
    )
      throw new Error("请提供登录凭据");
    if (
      old &&
      old.authType !== input.authType &&
      !(input.authType === "password" ? input.password : input.privateKey)
    )
      throw new Error("更换认证方式时必须输入新的凭据");
    if (input.authType === "password") {
      delete credential.privateKey;
      delete credential.passphrase;
    } else delete credential.password;
    const changed =
      !!old &&
      (old.address !== input.address ||
        old.port !== input.port ||
        old.username !== input.username ||
        old.authType !== input.authType);
    if (
      old &&
      (changed ||
        Object.keys(input).some((k) =>
          ["password", "privateKey", "sudoPassword", "passphrase"].includes(k),
        )) &&
      this.store
        .list<Task>("tasks")
        .some(
          (t) =>
            t.hostId === old.id &&
            ["running", "queued", "unknown"].includes(t.status),
        )
    )
      throw new Error("请先完成或核验该主机的任务再修改连接凭据");
    const host: Host = {
      id: old?.id || randomUUID(),
      name: input.name,
      address: input.address,
      port: input.port,
      username: input.username,
      group: input.group,
      tags: input.tags,
      authType: input.authType,
      credentialId: this.store.setSecret(
        JSON.stringify(credential),
        old?.credentialId,
      ),
      ...(old?.fingerprint && !changed ? { fingerprint: old.fingerprint } : {}),
    };
    this.store.put("hosts", host);
    if (changed) this.ssh.closeHost(host.id);
    this.probes.delete(host.id);
    this.changed();
    return host;
  }
  async handle(method: string, params: unknown = {}): Promise<any> {
    try {
      return await this.dispatch(method, params);
    } catch (error) {
      throw new Error(
        this.store.redact(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  private async dispatch(method: string, params: unknown): Promise<any> {
    switch (method) {
      case "snapshot":
        object({}).parse(params);
        return this.store.snapshot();
      case "host.save":
        return this.saveHost(hostSchema.parse(params));
      case "host.delete": {
        const p = object({ id }).parse(params);
        const host = this.ssh.host(p.id);
        if (
          this.store
            .list<Task>("tasks")
            .some(
              (t) =>
                t.hostId === p.id &&
                ["queued", "running", "unknown"].includes(t.status),
            )
        )
          throw new Error("主机仍有未完成任务");
        if (
          ["deployments", "monitoring"].some((c) =>
            this.store.list<any>(c).some((x) => x.hostId === p.id),
          )
        )
          throw new Error("请先移除该主机的部署及监控配置");
        this.ssh.closeHost(p.id);
        this.store.remove("hosts", p.id);
        this.store.deleteSecret(host.credentialId);
        this.changed();
        return true;
      }
      case "host.probe": {
        const p = object({ id }).parse(params);
        const host = this.ssh.host(p.id);
        const fingerprint = await this.ssh.probe(p.id);
        this.probes.set(p.id, {
          fingerprint,
          identity: JSON.stringify(host),
          expires: Date.now() + 300000,
        });
        return { fingerprint };
      }
      case "host.trust": {
        const p = object({
          id,
          fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]+$/),
        }).parse(params);
        const host = this.ssh.host(p.id),
          probe = this.probes.get(p.id);
        if (host.fingerprint && host.fingerprint !== p.fingerprint)
          throw new Error("主机密钥发生变化，请独立核验并重新建立主机记录");
        if (
          !probe ||
          probe.expires < Date.now() ||
          probe.fingerprint !== p.fingerprint ||
          probe.identity !== JSON.stringify(host)
        )
          throw new Error("请先重新获取主机指纹");
        this.store.put("hosts", { ...host, fingerprint: p.fingerprint });
        this.probes.delete(p.id);
        this.changed();
        return true;
      }
      case "host.check": {
        const p = object({ id }).parse(params);
        return this.ssh.exec(
          p.id,
          "printf '=== OS ===\\n'; cat /etc/os-release; printf '\\n=== ARCH ===\\n'; uname -m; printf '\\n=== TOOLS ===\\n'; for c in systemctl systemd-run bash tar docker curl; do command -v \"$c\" || true; done; printf '\\n=== SUDO ===\\n'; sudo -n true 2>/dev/null && echo passwordless || echo password-required",
        );
      }
      case "inspect": {
        const p = object({
          ...hostId,
          kind: z.enum([
            "overview",
            "metrics",
            "processes",
            "services",
            "journal",
            "containers",
            "containerLogs",
          ]),
          unit: unit.optional(),
        }).parse(params);
        if (p.kind === "containerLogs" && !p.unit)
          throw new Error("请填写容器名称或 ID");
        const commands = {
          overview: "uptime; free -m; df -h -x tmpfs -x devtmpfs; uname -a",
          metrics: metricsCommand,
          processes: "ps aux --sort=-%cpu | head -n 101",
          services: "systemctl list-units --type=service --all --no-pager",
          journal: `journalctl --no-pager -n 200 ${p.unit ? "-u " + q(p.unit) : ""}`,
          containers: "docker ps -a --no-trunc",
          containerLogs: `docker logs --tail 200 -- ${q(p.unit || "")}`,
        };
        return this.ssh.exec(p.hostId, commands[p.kind], {
          sudo: ["containers", "containerLogs", "journal"].includes(p.kind),
          raw: p.kind === "metrics",
        });
      }
      case "service.action": {
        const p = object({
          ...hostId,
          unit,
          action: z.enum(["start", "stop", "restart", "enable", "disable"]),
        }).parse(params);
        return this.tasks.preview({
          hostId: p.hostId,
          title: `${p.action} ${p.unit}`,
          script: `systemctl ${p.action} -- ${q(p.unit)}`,
          sudo: true,
          timeout: 120,
        });
      }
      case "container.action": {
        const p = object({
          ...hostId,
          id: z
            .string()
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
            .max(200),
          action: z.enum(["start", "stop", "restart"]),
        }).parse(params);
        return this.tasks.preview({
          hostId: p.hostId,
          title: `容器 ${p.action} ${p.id}`,
          script: `docker ${p.action} -- ${q(p.id)}`,
          sudo: true,
          timeout: 180,
        });
      }
      case "execution.preview":
        return this.tasks.preview(spec.parse(params));
      case "execution.run": {
        const p = object({ token: z.string().length(64), spec }).parse(params);
        return this.tasks.run(p.token, p.spec);
      }
      case "task.cancel":
        return this.tasks.cancel(object({ id }).parse(params).id);
      case "task.reconcile":
        return this.tasks.reconcile(object({ id }).parse(params).id);
      case "terminal.open": {
        const p = object({
          ...hostId,
          cols: z.number().int().min(1).max(500).optional(),
          rows: z.number().int().min(1).max(300).optional(),
        }).parse(params);
        return this.ssh.openTerminal(p.hostId, p.cols, p.rows);
      }
      case "terminal.write": {
        const p = object({ id, data: z.string().max(65536) }).parse(params);
        this.ssh.terminalWrite(p.id, p.data);
        return true;
      }
      case "terminal.resize": {
        const p = object({
          id,
          cols: z.number().int().min(1).max(500),
          rows: z.number().int().min(1).max(300),
        }).parse(params);
        this.ssh.terminalResize(p.id, p.cols, p.rows);
        return true;
      }
      case "terminal.close":
        this.ssh.terminalClose(object({ id }).parse(params).id);
        return true;
      case "file.list":
      case "file.read":
      case "file.mkdir":
      case "file.remove": {
        const p = object({ ...hostId, path }).parse(params);
        if (method === "file.remove" && p.path.replace(/\/+$/, "") === "")
          throw new Error("禁止删除根目录");
        return this.ssh[
          method.slice(5) as "list" | "read" | "mkdir" | "remove"
        ](p.hostId, p.path);
      }
      case "file.write": {
        const p = object({
          ...hostId,
          path,
          content: z.string().max(1000000),
        }).parse(params);
        await this.ssh.write(p.hostId, p.path, p.content);
        return true;
      }
      case "file.rename": {
        const p = object({ ...hostId, path, destination: path }).parse(params);
        await this.ssh.rename(p.hostId, p.path, p.destination);
        return true;
      }
      case "file.upload":
      case "file.download": {
        const p = object({
          ...hostId,
          path,
          localPath: z.string().min(1).max(4096),
        }).parse(params);
        const selected = this.selectedFiles.get(resolve(p.localPath));
        if (
          !isAbsolute(p.localPath) ||
          selected !== (method === "file.upload" ? "file" : "save")
        )
          throw new Error("请先通过文件选择对话框选择本地文件");
        if (method === "file.upload")
          await this.ssh.upload(p.hostId, p.localPath, p.path);
        else await this.ssh.download(p.hostId, p.path, p.localPath);
        return true;
      }
      case "dialog.open": {
        const p = object({ mode: z.enum(["file", "directory", "save"]) }).parse(
          params,
        );
        const result = await this.options.chooseFile(p.mode);
        if (result) this.selectedFiles.set(resolve(result), p.mode);
        return result;
      }
      case "script.save": {
        const p = object({
          name: text,
          body: z.string().min(1).max(500000),
        }).parse(params);
        const old = this.store
          .list<ScriptVersion>("scripts")
          .filter((s) => s.name === p.name);
        const script: ScriptVersion = {
          ...p,
          id: randomUUID(),
          version: Math.max(0, ...old.map((s) => s.version)) + 1,
          createdAt: new Date().toISOString(),
        };
        this.store.put("scripts", script);
        this.changed();
        return script;
      }
      default:
        throw new Error("不支持的操作：" + method);
    }
  }
  async close(): Promise<void> {
    const stopped = this.tasks.close();
    this.ssh.close();
    await stopped;
    this.store.close();
  }
}
