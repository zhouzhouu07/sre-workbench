import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Backend } from "../src/main/core/backend";
import {
  BenchmarkService,
  benchmarkSummary,
} from "../src/main/features/benchmark";
import { ExecutionTraceService } from "../src/main/features/execution-trace";
import {
  fixture as seed,
  verification,
} from "../src/main/features/benchmark-scenarios";
import type { BenchmarkRun } from "../src/shared/benchmark";
const cleanup: (() => Promise<unknown> | void)[] = [];
it("pauses the whole experiment on provider billing failure and excludes it from agent capability scores",async()=>{
 const {service,start,core,exec}=await fixture();const r=await start({scenarios:[1,2],interactionPolicy:"record_failure"});const c=r.cells[0];Object.assign(c,{phase:"running",source:"agent",sourceId:"billing",startedAt:r.createdAt,deadline:new Date(Date.now()+60000).toISOString()});core.store.put("benchmarkRuns",r);core.store.put("aiSessions",{id:"billing",status:"failed",summary:"API 请求失败（HTTP 402，anthropic）：余额不足",instruction:"deploy",steps:[],createdAt:r.createdAt,updatedAt:r.createdAt,target:{kind:"ssh",hostId:"h",root:c.root,sudo:false},permission:"autonomous",modelUsageCaptured:true});await service.tick();const saved=core.store.get<BenchmarkRun>("benchmarkRuns",r.id)!;expect(saved.status).toBe("paused");expect(saved.cells[0].phase).toBe("environment_blocked");expect(saved.cells[1].phase).toBe("pending");expect(benchmarkSummary(saved)[0]).toMatchObject({evaluated:0,environmentBlocks:1,successRate:null});expect(exec).not.toHaveBeenCalled();
});
it("records a need for external input as autonomous failure when explicitly configured, without granting approval",async()=>{
 const {service,start,core,agent}=await fixture();const r=await start({interactionPolicy:"record_failure"});const c=r.cells[0];Object.assign(c,{phase:"running",source:"agent",sourceId:"needs-input",startedAt:r.createdAt,deadline:new Date(Date.now()+60000).toISOString()});core.store.put("benchmarkRuns",r);core.store.put("aiSessions",{id:c.sourceId!,status:"awaiting_input",summary:"需要操作人处理",instruction:"deploy",steps:[],createdAt:r.createdAt,updatedAt:r.createdAt,target:{kind:"ssh",hostId:"h",root:c.root,sudo:false},permission:"autonomous",modelUsageCaptured:true});await service.tick();expect(agent.handle).toHaveBeenCalledWith("ai.session.stop",{id:c.sourceId});await service.tick();const saved=core.store.get<BenchmarkRun>("benchmarkRuns",r.id)!;expect(saved.cells[0]).toMatchObject({phase:"completed",success:false,claimedSuccess:false});expect(saved.status).toBe("running");expect(benchmarkSummary(saved)[0].humanInterventionRate).toBe(0);
});
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.restoreAllMocks();
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-bench-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "export.json"),
    core = new Backend({
      dataDir: dir,
      encrypt: (s) => s,
      decrypt: (s) => s,
      emit: () => {},
      chooseFile: async () => file,
    });
  await core.init();
  cleanup.push(() => core.close());
  core.store.put("hosts", {
    id: "h",
    name: "test",
    username: "root",
    address: "127.0.0.1",
    port: 22,
    fingerprint: "test",
  });
  core.store.put("providers", {
    id: "p",
    kind: "model",
    name: "test",
    model: "test",
  });
  const exec = vi
    .spyOn(core.ssh, "exec")
    .mockResolvedValue({ code: 0, stdout: "verified", stderr: "" });
  const agent = {
    handle: vi.fn(
      async (method: string, p: any, _snapshot: any, id: string) => {
        if (method === "ai.session.start") {
          core.store.put("aiSessions", {
            id,
            status: "running",
            ...p,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            steps: [],
            summary: "running",
          });
          return { id };
        }
        return {};
      },
    ),
  };
  const workflow = { handle: vi.fn(), startPrepared: vi.fn() };
  const restart = vi.fn();
  const service = new BenchmarkService(
    core,
    agent as any,
    workflow as any,
    new ExecutionTraceService(core),
    () => {},
    restart,
  );
  cleanup.push(() => service.close());
  const start = async (extra = {}) =>
    (await service.handle("studio.benchmark.start", {
      hostId: "h",
      providerId: "p",
      scenarios: [1],
      modes: ["A"],
      ...extra,
    })) as BenchmarkRun;
  return { core, service, start, file, exec, agent, workflow, restart };
}
it("generates 36 unique safe resource namespaces and refuses overlapping suites or missing restart consent", async () => {
  const { start, core } = await fixture();
  await expect(start({ scenarios: [11] })).rejects.toThrow("重启");
  const r = await start({
    scenarios: Array.from({ length: 12 }, (_, i) => i + 1),
    modes: ["A", "B", "C"],
    allowRestart: true,
  });
  expect(r.cells).toHaveLength(36);
  expect(new Set(r.cells.map((c) => c.root)).size).toBe(36);
  for (const c of r.cells) {
    expect(seed(c)).toContain(c.root);
    expect(verification(c)).not.toContain("rm ");
  }
  expect(() => seed({ ...r.cells[0], root: "/etc" })).toThrow();
  await expect(start()).rejects.toThrow("现有实验");
  expect((core.store.snapshot() as any).benchmarkRuns).toBeUndefined();
});
it("persists preparation reference and never resubmits unknown preparation tasks", async () => {
  const { service, start, core, agent } = await fixture();
  const r = await start();
  const preview = vi
      .spyOn(core.tasks, "preview")
      .mockReturnValue({ token: "token" } as any),
    submit = vi.spyOn(core.tasks, "run").mockImplementation(() => {
      core.store.put("tasks", { id: "seed", status: "unknown" });
      return { id: "seed" } as any;
    });
  vi.spyOn(core.tasks, "reconcile").mockResolvedValue({
    id: "seed",
    status: "unknown",
  } as any);
  await service.tick();
  await service.tick();
  await service.tick();
  expect(preview).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledOnce();
  expect(agent.handle).not.toHaveBeenCalled();
  expect(
    core.store.get<BenchmarkRun>("benchmarkRuns", r.id)?.cells[0].seedTaskId,
  ).toBe("seed");
});
it("separates setup failures, failed independent verification and false success claims", async () => {
  const { service, start, core, exec, file } = await fixture();
  const r = await start({ modes: ["A", "B", "C"] });
  r.cells[0].phase = "evaluating";
  r.cells[0].source = "agent";
  r.cells[0].sourceId = "done";
  r.cells[0].startedAt = r.createdAt;
  r.cells[1].phase = "setup_failed";
  core.store.put("benchmarkRuns", r);
  core.store.put("aiSessions", {
    id: "done",
    instruction: "test",
    summary: "reported success",
    createdAt: r.createdAt,
    updatedAt: r.createdAt,
    status: "completed",
    target: { kind: "ssh", hostId: "h", root: "/", sudo: false },
    permission: "autonomous",
    steps: [],
    modelUsageCaptured: true,
  });
  exec.mockResolvedValue({ code: 1, stdout: "", stderr: "actual HTTP failed" });
  await service.tick();
  const got = core.store.get<BenchmarkRun>("benchmarkRuns", r.id)!;
  expect(got.cells[0]).toMatchObject({
    success: false,
    claimedSuccess: true,
    incorrectSuccessClaim: true,
  });
  expect(benchmarkSummary(got)[0]).toMatchObject({
    evaluated: 1,
    successRate: 0,
    incorrectSuccessClaims: 1,
    totalTokens: null,
  });
  expect(benchmarkSummary(got)[1]).toMatchObject({
    evaluated: 0,
    setupFailures: 1,
    successRate: null,
  });
  core.store.setSecret("benchmark-test-secret");
  got.cells[0].error = "benchmark-test-secret";
  core.store.put("benchmarkRuns", got);
  await service.handle("studio.benchmark.export", { id: r.id, format: "json" });
  expect(await readFile(file, "utf8")).not.toContain("benchmark-test-secret");
  await service.handle("studio.benchmark.export", { id: r.id, format: "csv" });
  expect(await readFile(file, "utf8")).toContain('"incorrectSuccessClaim"');
});
it("only injects a transport fault into the selected benchmark task and persists restart evidence first", async () => {
  const { start, core, exec, restart } = await fixture();
  const r = await start({ scenarios: [9, 11], allowRestart: true });
  const c = r.cells[0];
  c.phase = "running";
  c.source="agent";c.sourceId="a";core.store.put("aiSessions",{id:"a",steps:[{taskId:"read-script"},{taskId:"job"}]});
  core.store.put("benchmarkRuns", r);
  core.store.put("tasks",{id:"read-script",hostId:"h",submitted:true,directory:"/var/lib/read-script",logs:`printf '%s' 'SRE_BENCH_EXEC:${c.id}'`,spec:{script:`cat ${c.root}/work.sh`}});
  await core.ssh.exec("h","SRE_LOG_BEGIN /var/lib/read-script");expect(exec.mock.lastCall?.[2]).toBeUndefined();
  core.store.put("tasks", {
    id: "job",
    hostId: "h",
    submitted: true,
    directory: "/var/lib/job",
    spec: { script: `bash ${c.root}/work.sh` },
    logs:`SRE_BENCH_EXEC:${c.id}\n`,
  });
  await core.ssh.exec("h", "SRE_LOG_BEGIN unrelated");
  expect(exec.mock.lastCall?.[2]).toBeUndefined();
  await core.ssh.exec("h", "SRE_LOG_BEGIN /var/lib/job");
  expect(exec.mock.lastCall?.[2]).toMatchObject({ disconnectAfterMs: 50 });
  const saved = core.store.get<BenchmarkRun>("benchmarkRuns", r.id)!;
  expect(saved.cells[0].injections).toHaveLength(1);
  saved.cells[0].phase = "completed";
  saved.cells[1].phase = "running";
  saved.cells[1].source="agent";saved.cells[1].sourceId="b";core.store.put("aiSessions",{id:"b",steps:[{taskId:"job2"}]});
  core.store.put("benchmarkRuns", saved);
  core.store.put("tasks", {
    id: "job2",
    hostId: "h",
    submitted: true,
    directory: "/var/lib/job2",
    spec: { script: `bash ${saved.cells[1].root}/work.sh` },
    logs:`SRE_BENCH_EXEC:${saved.cells[1].id}\n`,
  });
  await expect(
    core.ssh.exec("h", "SRE_LOG_BEGIN /var/lib/job2"),
  ).rejects.toThrow("重启");
  expect(restart).toHaveBeenCalledOnce();
  expect(core.store.get<BenchmarkRun>("benchmarkRuns", r.id)?.status).toBe(
    "paused",
  );
});
it("refuses replay when crash left a missing source reference and pins host/model identity", async () => {
  const { service, start, core, agent } = await fixture();
  const r = await start();
  r.cells[0].phase = "running";
  core.store.put("benchmarkRuns", r);
  await service.tick();
  expect(
    core.store.get<BenchmarkRun>("benchmarkRuns", r.id)?.summary,
  ).toContain("禁止自动重发");
  expect(agent.handle).not.toHaveBeenCalled();
  await service.handle("studio.benchmark.resume", { id: r.id });
  core.store.put("providers", { id: "p", kind: "model", model: "changed" });
  await service.tick();
  expect(
    core.store.get<BenchmarkRun>("benchmarkRuns", r.id)?.summary,
  ).toContain("配置已变化");
});
