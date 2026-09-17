import { randomUUID } from "node:crypto";
import type {
  AppEvent,
  ExecutionSpec,
  ExecutionPreview,
  Host,
  Task,
} from "../../shared/types";
import { Store } from "./store";
import { SSHManager } from "./ssh";
import { ApprovalBook, digest, HostScheduler, shellQuote as q } from "./safety";

interface StoredTask extends Task {
  spec: ExecutionSpec;
  directory?: string;
  cancelRequested?: boolean;
  system?: boolean;
  submitted?: boolean;
}
export interface TaskHooks {
  prepare?: (task: Task) => Promise<void>;
  after?: (task: Task) => Promise<void>;
}
export function renderJobWrapper(directory: string): string {
  return `#!/bin/bash
cd -- ${q(directory)} || exit 125
/bin/bash ./work.sh 2>&1 | {
  head -c 1000000 > ./output.log || exit 125
  dd bs=1 count=1 of=./output.overflow status=none || exit 125
  if test -s ./output.overflow; then printf '\\n[SRE: output exceeded 1000000 bytes; remaining output discarded]\\n' >> ./output.log; fi
  cat > /dev/null
}
statuses=("\${PIPESTATUS[@]}")
result=\${statuses[0]}
if test "\${statuses[1]}" -ne 0; then result=125; fi
if test -s ./output.overflow && test "$result" -eq 0; then result=122; fi
printf '%s' "$result" > ./exit.tmp
mv -- ./exit.tmp ./exit.code
exit "$result"
`;
}
export class TaskManager {
  private approvals = new ApprovalBook();
  private scheduler = new HostScheduler(3);
  private stopped = false;
  private jobs = new Set<Promise<unknown>>();
  constructor(
    private store: Store,
    private ssh: SSHManager,
    private emit: (e: AppEvent) => void,
  ) {}
  init(): void {
    for (const task of this.store.list<StoredTask>("tasks")) {
      if (task.status === "running" || task.status === "queued")
        this.update({
          ...task,
          status: "unknown",
          step: "应用重启，请核对远程结果",
        });
      if (this.get(task.id).status === "unknown")
        this.track(
          this.scheduler.schedule(task.hostId, () => this.monitor(task.id)),
        );
    }
  }
  private track(job: Promise<unknown>): void {
    this.jobs.add(job);
    void job.catch(() => {}).finally(() => this.jobs.delete(job));
  }
  private async monitor(id: string): Promise<void> {
    while (!this.stopped) {
      const task = this.get(id);
      if (!["running", "unknown"].includes(task.status)) return;
      await new Promise((r) => setTimeout(r, 1000));
      if (this.stopped) return;
      if (this.get(id).status === "running") await this.reconcile(id);
    }
  }
  private identity(host: Host): string {
    return JSON.stringify([
      host.id,
      host.address,
      host.port,
      host.username,
      host.authType,
      host.credentialId,
      host.fingerprint,
    ]);
  }
  preview(spec: ExecutionSpec): ExecutionPreview {
    const host = this.ssh.host(spec.hostId);
    if (!host.fingerprint) throw new Error("请先信任 SSH 主机指纹");
    const identity = this.identity(host);
    return {
      ...spec,
      token: this.approvals.issue(spec, identity),
      digest: digest(spec, identity),
      username: spec.sudo ? "root" : host.username,
      hostName: host.name,
    };
  }
  run(token: string, spec: ExecutionSpec, hooks: TaskHooks = {}): Task {
    const host = this.ssh.host(spec.hostId);
    this.approvals.consume(token, spec, this.identity(host));
    if (
      this.store
        .list<Task>("tasks")
        .some((t) => t.hostId === host.id && t.status === "unknown")
    )
      throw new Error("该主机存在未知任务，请先核对结果");
    const task: StoredTask = {
      id: randomUUID(),
      hostId: spec.hostId,
      title: spec.title,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      logs: "",
      spec,
      system: spec.sudo || host.username === "root",
    };
    task.unit = "sre-" + task.id;
    this.update(task);
    this.track(
      this.scheduler.schedule(host.id, async () => {
        if (this.stopped || this.get(task.id).status !== "queued") return;
        if (
          this.store
            .list<Task>("tasks")
            .some((t) => t.hostId === host.id && t.status === "unknown") ||
          this.store.list<Task>("tasks").filter((t) => t.status === "unknown")
            .length >= 3
        ) {
          this.update({
            ...task,
            status: "unknown",
            step: "前序任务需核验，尚未提交",
          });
          return;
        }
        try {
          task.status = "running";
          task.step = "准备任务资源";
          this.update(task);
          await hooks.prepare?.(this.public(task));
          if (this.get(task.id).cancelRequested) {
            task.status = "cancelled";
            task.step = "准备期间取消，未提交远程作业";
            this.update(task);
          } else if (!this.stopped) {
            await this.execute(task);
            await this.monitor(task.id);
          }
        } catch (error) {
          task.status = this.get(task.id).cancelRequested
            ? "cancelled"
            : "failed";
          task.step = "准备失败";
          task.logs += "\n" + String(error);
          this.update(task);
        }
        const final = this.get(task.id);
        if (["succeeded", "failed", "cancelled"].includes(final.status))
          try {
            await hooks.after?.(this.public(final));
          } catch (error) {
            final.logs += "\n后处理失败：" + String(error);
            final.step = "远程结果已保存，后处理需核验";
            this.update(final);
          }
      }),
    );
    return this.public(task);
  }
  private public(task: StoredTask): Task {
    const { spec, directory, cancelRequested, system, submitted, ...result } =
      task;
    return result;
  }
  private get(id: string): StoredTask {
    const task = this.store.get<StoredTask>("tasks", id);
    if (!task) throw new Error("任务不存在");
    return task;
  }
  private update(task: StoredTask): void {
    if (this.store.get<StoredTask>("tasks", task.id)?.cancelRequested)
      task.cancelRequested = true;
    task.updatedAt = new Date().toISOString();
    task.logs = this.store.redact(task.logs).slice(-1_000_000);
    this.store.put("tasks", task);
    this.emit({ type: "changed" });
  }
  private async execute(task: StoredTask): Promise<void> {
    let submitted = false;
    try {
      task.status = "running";
      task.step = "准备远程作业";
      this.update(task);
      const tools = await this.ssh.exec(
        task.hostId,
        "command -v systemd-run >/dev/null && command -v systemctl >/dev/null && command -v bash >/dev/null && command -v head >/dev/null && command -v dd >/dev/null",
        { sudo: task.spec.sudo },
      );
      if (tools.code !== 0)
        throw new Error(
          "systemd/bash/coreutils 或 sudo 预检失败：" + tools.stderr,
        );
      if (!task.system) {
        const ready = await this.ssh.exec(
          task.hostId,
          'test "$(loginctl show-user "$(id -u)" -p Linger --value 2>/dev/null)" = yes && systemctl --user show-environment >/dev/null',
        );
        if (ready.code !== 0)
          throw new Error(
            "普通用户的 systemd 持久运行未启用。请管理员执行 loginctl enable-linger 用户名，并确认 systemctl --user 可用；或预览时选择 sudo。",
          );
      }
      const home = await this.ssh.exec(task.hostId, 'printf %s "$HOME"', {
        raw: true,
      });
      if (home.code !== 0 || !home.stdout.startsWith("/"))
        throw new Error("无法获取远程用户目录");
      task.directory =
        home.stdout + "/.local/share/sre-workbench/jobs/" + task.id;
      this.update(task);
      const prep = await this.ssh.exec(
        task.hostId,
        `umask 077; mkdir -p -- ${q(task.directory)} && : > ${q(task.directory + "/output.log")}`,
      );
      if (prep.code !== 0) throw new Error(prep.stderr || "远程目录创建失败");
      await this.ssh.write(
        task.hostId,
        task.directory + "/work.sh",
        task.spec.script,
      );
      const wrapper = renderJobWrapper(task.directory);
      await this.ssh.write(task.hostId, task.directory + "/run.sh", wrapper);
      if (this.get(task.id).cancelRequested) {
        this.update({ ...task, status: "cancelled", step: "提交前取消" });
        return;
      }
      task.step = "提交 systemd 作业";
      task.submitted = true;
      this.update(task);
      submitted = true;
      const launched = await this.ssh.exec(
        task.hostId,
        `systemd-run ${task.system ? "" : "--user "}--unit=${q(task.unit!)} --property=Type=exec --property=RemainAfterExit=yes --property=RuntimeMaxSec=${task.spec.timeout} -- /bin/bash ${q(task.directory + "/run.sh")}`,
        { sudo: task.spec.sudo },
      );
      if (launched.code !== 0) {
        task.logs = launched.stderr;
        task.status = "unknown";
        task.step = "提交响应异常，请核验是否已创建服务";
        this.update(task);
        return;
      }
      task.step = "远程执行中";
      this.update(task);
      if (this.get(task.id).cancelRequested) await this.cancel(task.id);
    } catch (error) {
      task.status = submitted ? "unknown" : "failed";
      task.logs +=
        "\n" +
        this.store.redact(
          error instanceof Error ? error.message : String(error),
        );
      task.step = submitted ? "连接中断，需核对远程结果" : "准备失败";
      this.update(task);
    }
  }
  async reconcile(id: string): Promise<Task> {
    const task = this.get(id);
    if (["succeeded", "failed", "cancelled"].includes(task.status))
      return this.public(task);
    if (!task.submitted) {
      if (task.status === "running") return this.public(task);
      task.status = "cancelled";
      task.step = "确认未提交远程作业";
      this.update(task);
      return this.public(task);
    }
    if (!task.directory) {
      task.status = "unknown";
      task.step = "缺少远程目录元数据，需要人工核验";
      this.update(task);
      return this.public(task);
    }
    try {
      const result = await this.ssh.exec(
        task.hostId,
        `if test -f ${q(task.directory + "/exit.code")}; then printf 'SRE_EXIT='; cat -- ${q(task.directory + "/exit.code")}; printf '\n'; fi; systemctl ${task.system ? "" : "--user "}show ${q(task.unit!)} --property=LoadState --property=ActiveState --property=SubState --property=Result --property=ExecMainStatus; printf '\nSRE_LOG_BEGIN\n'; tail -c 500000 -- ${q(task.directory + "/output.log")}`,
        { sudo: task.spec.sudo, raw: true },
      );
      const [meta, ...log] = result.stdout.split("\nSRE_LOG_BEGIN\n");
      task.logs = log.join("\nSRE_LOG_BEGIN\n");
      const exit = meta.match(/^SRE_EXIT=(\d+)$/m);
      if (exit) {
        task.exitCode = Number(exit[1]);
        task.status = task.cancelRequested
          ? "cancelled"
          : task.exitCode === 0
            ? "succeeded"
            : "failed";
        task.step = "已取得持久化退出码";
      } else if (
        /^ActiveState=(active|activating)$/m.test(meta) &&
        !/^SubState=exited$/m.test(meta)
      ) {
        task.status = "running";
        task.step = "远程执行中";
      } else if (
        /^LoadState=loaded$/m.test(meta) &&
        /^ActiveState=(failed|inactive)$/m.test(meta)
      ) {
        task.status = task.cancelRequested ? "cancelled" : "failed";
        task.exitCode =
          Number(meta.match(/^ExecMainStatus=(\d+)$/m)?.[1] || 1) || 1;
        task.step = meta.match(/^Result=(.*)$/m)?.[1] || "服务已退出";
      } else {
        task.status = "unknown";
        task.step = "未发现确定结果；不要自动重试";
      }
      const latest = this.get(id);
      if (latest.status === "cancelled") return this.public(latest);
      if (latest.cancelRequested) {
        task.cancelRequested = true;
        if (task.status === "failed") task.status = "cancelled";
      }
      this.update(task);
      return this.public(task);
    } catch (error) {
      const latest = this.get(id);
      if (latest.status === "cancelled") return this.public(latest);
      task.status = "unknown";
      task.step =
        "核验失败：" +
        this.store.redact(
          error instanceof Error ? error.message : String(error),
        );
      this.update(task);
      return this.public(task);
    }
  }
  async cancel(id: string): Promise<Task> {
    const task = this.get(id);
    if (["succeeded", "failed", "cancelled"].includes(task.status))
      return this.public(task);
    task.cancelRequested = true;
    if (task.status === "queued") {
      task.status = "cancelled";
      task.step = "已取消排队";
      this.update(task);
      return this.public(task);
    }
    this.update(task);
    if (!task.submitted) return this.public(task);
    try {
      const result = await this.ssh.exec(
        task.hostId,
        `systemctl ${task.system ? "" : "--user "}stop ${q(task.unit!)}`,
        { sudo: task.spec.sudo },
      );
      if (result.code !== 0) throw new Error(result.stderr);
      task.status = "cancelled";
      task.step = "systemd 已确认停止任务";
      this.update(task);
      return this.public(task);
    } catch (error) {
      task.status = "unknown";
      task.step = "取消请求未确认：" + this.store.redact(String(error));
      this.update(task);
      return this.public(task);
    }
  }
  async close(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.jobs]);
  }
}
