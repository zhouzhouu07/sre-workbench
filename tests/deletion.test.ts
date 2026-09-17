import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Backend } from "../src/main/core/backend";
import { FeatureService } from "../src/main/features/operations";

const resources: { core: Backend; service: FeatureService; dir: string }[] = [];
afterEach(async () => {
  for (const { core, service, dir } of resources.splice(0)) {
    service.close();
    await core.close();
    await rm(dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sre-delete-"));
  const core = new Backend({
    dataDir: dir,
    encrypt: (s) => s,
    decrypt: (s) => s,
    emit: () => {},
    chooseFile: async () => null,
  });
  await core.init();
  const service = new FeatureService(core, {
    gitPath: "git",
    tempDir: dir,
    openExternal: async () => {},
  });
  resources.push({ core, service, dir });
  return { core, service };
}
it("removes only the chosen script version and retains execution history", async () => {
  const { core } = await setup();
  const a = await core.handle("script.save", { name: "巡检", body: "uptime" });
  const b = await core.handle("script.save", { name: "巡检", body: "df -h" });
  core.store.put("tasks", {
    id: "history",
    status: "succeeded",
    logs: "result",
  });
  await core.handle("script.delete", { id: a.id });
  expect(core.store.snapshot().scripts.map((s) => s.id)).toEqual([b.id]);
  expect(core.store.snapshot().tasks[0].logs).toBe("result");
});
it.each(["queued", "running", "unknown"])(
  "refuses deletion of %s task",
  async (status) => {
    const { core } = await setup();
    core.store.put("tasks", { id: "task", hostId: "h", status });
    await expect(core.handle("task.delete", { id: "task" })).rejects.toThrow(
      /未完成|核实/,
    );
    expect(core.store.get("tasks", "task")).toBeDefined();
  },
);
it.each(["succeeded", "failed", "cancelled"])(
  "deletes %s task without deleting its release",
  async (status) => {
    const { core } = await setup();
    core.store.put("tasks", { id: "task", hostId: "h", status });
    core.store.put("releases", {
      id: "release",
      taskId: "task",
      deploymentId: "deployment",
      status: "active",
    });
    await core.handle("task.delete", { id: "task" });
    expect(core.store.get("tasks", "task")).toBeUndefined();
    expect(core.store.get("releases", "release")?.status).toBe("active");
  },
);
it("removes deployment metadata and secrets but retains task history and unrelated records", async () => {
  const { core, service } = await setup();
  const env = core.store.setSecret("env-secret"),
    git = core.store.setSecret("git-secret");
  core.store.put("deployments", {
    id: "11111111-1111-4111-8111-111111111111",
    hostId: "h",
    envCredentialId: env,
    gitCredentialId: git,
  });
  core.store.put("releases", {
    id: "r",
    deploymentId: "11111111-1111-4111-8111-111111111111",
  });
  core.store.put("releases", { id: "other", deploymentId: "other" });
  core.store.put("tasks", { id: "t", hostId: "h", status: "succeeded" });
  await service.handle("deployment.delete", {
    id: "11111111-1111-4111-8111-111111111111",
  });
  expect(
    core.store.get("deployments", "11111111-1111-4111-8111-111111111111"),
  ).toBeUndefined();
  expect(core.store.list("releases").map((r) => r.id)).toEqual(["other"]);
  expect(core.store.getSecret(env)).toBeUndefined();
  expect(core.store.getSecret(git)).toBeUndefined();
  expect(core.store.get("tasks", "t")).toBeDefined();
});
it("blocks monitor deletion while a target has unresolved work, then cleans its own secrets", async () => {
  const { core, service } = await setup();
  const smtp = core.store.setSecret("smtp"),
    grafana = core.store.setSecret("grafana"),
    webhook = core.store.setSecret("hook");
  core.store.put("monitoring", {
    id: "22222222-2222-4222-8222-222222222222",
    hostId: "h",
    targets: [{ hostId: "target" }],
    smtpCredentialId: smtp,
    grafanaCredentialId: grafana,
    webhookCredentialId: webhook,
  });
  core.store.put("tasks", { id: "t", hostId: "target", status: "unknown" });
  await expect(
    service.handle("monitoring.delete", {
      id: "22222222-2222-4222-8222-222222222222",
    }),
  ).rejects.toThrow(/未完成|核实/);
  expect(core.store.getSecret(smtp)).toBe("smtp");
  core.store.put("tasks", { id: "t", hostId: "target", status: "failed" });
  await service.handle("monitoring.delete", {
    id: "22222222-2222-4222-8222-222222222222",
  });
  expect(
    core.store.get("monitoring", "22222222-2222-4222-8222-222222222222"),
  ).toBeUndefined();
  for (const id of [smtp, grafana, webhook])
    expect(core.store.getSecret(id)).toBeUndefined();
});
it("blocks deleting a host referenced only as a monitoring target", async () => {
  const { core } = await setup();
  const host = await core.handle("host.save", {
    name: "target",
    address: "192.0.2.1",
    port: 22,
    username: "root",
    authType: "password",
    password: "pw",
  });
  core.store.put("monitoring", {
    id: "22222222-2222-4222-8222-222222222222",
    hostId: "another-host",
    targets: [{ hostId: host.id, address: "192.0.2.1" }],
  });
  await expect(core.handle("host.delete", { id: host.id })).rejects.toThrow(
    /监控/,
  );
  expect(core.store.get("hosts", host.id)).toBeDefined();
});
it("retains a finished task while asynchronous cleanup still needs it", async () => {
  const { core } = await setup();
  core.store.put("hosts", {
    id: "h",
    name: "h",
    username: "root",
    fingerprint: "trusted",
  });
  let finish!: () => void, reached!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const spec = {
    hostId: "h",
    title: "prepare failure",
    script: "true",
    sudo: true,
    timeout: 30,
  };
  const preview = core.tasks.preview(spec);
  const task = core.tasks.run(preview.token, spec, {
    prepare: async () => {
      throw new Error("source missing");
    },
    after: async () => {
      reached();
      await cleanup;
    },
  });
  await started;
  try {
    expect(core.store.get("tasks", task.id).status).toBe("failed");
    await expect(core.handle("task.delete", { id: task.id })).rejects.toThrow(
      /收尾/,
    );
  } finally {
    finish();
  }
});
it("retains completed exporter results until dependent monitoring deployment finishes", async () => {
  const { core } = await setup();
  core.store.put("tasks", {
    id: "exporter",
    hostId: "target",
    status: "succeeded",
  });
  core.store.put("tasks", {
    id: "monitor",
    hostId: "server",
    status: "queued",
    dependencyIds: ["exporter"],
  });
  await expect(core.handle("task.delete", { id: "exporter" })).rejects.toThrow(
    /依赖/,
  );
  expect(core.store.get("tasks", "exporter")).toBeDefined();
  core.store.put("tasks", {
    id: "monitor",
    hostId: "server",
    status: "failed",
    dependencyIds: ["exporter"],
  });
  await core.handle("task.delete", { id: "exporter" });
  expect(core.store.get("tasks", "exporter")).toBeUndefined();
});
