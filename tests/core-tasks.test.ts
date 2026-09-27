import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/core/store";
import { TaskManager } from "../src/main/core/tasks";
import type { SSHManager } from "../src/main/core/ssh";
it("reconciles persisted remote exit code, redacts logs, and never resubmits an unknown job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sre-task-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  store.setSecret("known-secret");
  const commands: string[] = [];
  const ssh = {
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return {
        code: 0,
        stderr: "",
        stdout:
          "SRE_EXIT=7\nLoadState=loaded\nActiveState=failed\nResult=exit-code\nExecMainStatus=7\n\nSRE_LOG_BEGIN\nknown-secret failed",
      };
    },
  } as unknown as SSHManager;
  const tasks = new TaskManager(store, ssh, () => {});
  store.put("tasks", {
    id: "task",
    hostId: "host",
    title: "Test",
    status: "unknown",
    createdAt: "now",
    updatedAt: "now",
    logs: "",
    directory: "/home/a/job",
    unit: "sre-task",
    submitted: true,
    system: true,
    spec: {
      hostId: "host",
      title: "Test",
      script: "exit 7",
      sudo: true,
      timeout: 60,
    },
  });
  try {
    const result = await tasks.reconcile("task");
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(7);
    expect(result.logs).toBe("[REDACTED] failed");
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain("systemd-run");
    expect(JSON.stringify(store.snapshot())).not.toContain("exit 7");
  } finally {
    await tasks.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("blocks unconfirmed host jobs instead of automatically retrying", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sre-task-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  const host = {
    id: "host",
    address: "host",
    port: 22,
    username: "root",
    authType: "password",
    credentialId: "c",
    fingerprint: "fp",
    name: "test",
  };
  const ssh = { host: () => host } as unknown as SSHManager;
  const tasks = new TaskManager(store, ssh, () => {});
  const spec = {
    hostId: "host",
    title: "Test",
    script: "echo hi",
    sudo: true,
    timeout: 60,
  };
  store.put("tasks", { id: "unknown", hostId: "host", status: "unknown" });
  try {
    const preview = tasks.preview(spec);
    expect(() => tasks.run(preview.token, spec)).toThrow("未知任务");
  } finally {
    await tasks.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import { vi } from "vitest";
it("automatically rechecks a disconnected persisted job without resubmitting", async () => {
  vi.useFakeTimers();
  const dir = mkdtempSync(join(tmpdir(), "sre-recovery-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  const exec = vi
    .fn()
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValue({
      code: 0,
      stderr: "",
      stdout:
        "SRE_EXIT=0\nLoadState=loaded\nActiveState=active\nSubState=exited\n\nSRE_LOG_BEGIN\ncompleted once",
    });
  const tasks = new TaskManager(
    store,
    { exec } as unknown as SSHManager,
    () => {},
  );
  store.put("tasks", {
    id: "recover",
    hostId: "host",
    title: "Long job",
    status: "running",
    logs: "",
    submitted: true,
    directory: "/tmp/job",
    unit: "sre-recover",
    system: true,
    spec: { sudo: false },
  });
  try {
    tasks.init();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.get<any>("tasks", "recover").status).toBe("succeeded");
    expect(exec).toHaveBeenCalledTimes(2);
    expect(
      exec.mock.calls.every((c) => !String(c[1]).includes("systemd-run")),
    ).toBe(true);
  } finally {
    const closed = tasks.close();
    await vi.runAllTimersAsync();
    await closed;
    vi.useRealTimers();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("caps failed status queries and refuses a changed host without sending commands", async () => {
  vi.useFakeTimers();
  const dir = mkdtempSync(join(tmpdir(), "sre-retry-cap-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  const exec = vi.fn().mockRejectedValue(new Error("offline"));
  const tasks = new TaskManager(
    store,
    { exec, host: () => ({ id: "changed" }) } as unknown as SSHManager,
    () => {},
  );
  store.put("tasks", {
    id: "retry",
    hostId: "host",
    title: "Long job",
    status: "unknown",
    logs: "",
    submitted: true,
    directory: "/tmp/job",
    unit: "sre-retry",
    system: true,
    spec: { sudo: false },
  });
  try {
    tasks.init();
    await vi.advanceTimersByTimeAsync(120000);
    expect(exec).toHaveBeenCalledTimes(5);
    expect(store.get<any>("tasks", "retry").status).toBe("unknown");
    expect(store.get<any>("tasks", "retry").reconcileFailures).toBe(5);
    const saved = store.get<any>("tasks", "retry");
    store.put("tasks", { ...saved, hostIdentity: "original-host" });
    await tasks.reconcile("retry");
    expect(exec).toHaveBeenCalledTimes(5);
    await expect(tasks.cancel("retry")).rejects.toThrow("主机配置已变化");
    expect(exec).toHaveBeenCalledTimes(5);
  } finally {
    const closed = tasks.close();
    await vi.runAllTimersAsync();
    await closed;
    vi.useRealTimers();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
