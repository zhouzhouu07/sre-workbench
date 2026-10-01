import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { z } from "zod";
import type { Backend } from "../core/backend";
import type { AgentService } from "./agent";
import type { WorkflowRuntime } from "./workflow-runtime";
import type { ExecutionTraceService } from "./execution-trace";
import { workflowHash } from "./workflow-registry";
import { RiskEngine } from "./risk-engine";
import { fixture, instruction, verification } from "./benchmark-scenarios";
import {
  benchmarkModes,
  benchmarkScenarios,
  type BenchmarkRun,
  type BenchmarkCell,
} from "../../shared/benchmark";
import type { AgentSession } from "../../shared/agent";
import type { WorkflowNode, WorkflowRun } from "../../shared/workflow";
import type { AIProvider, Host, Task } from "../../shared/types";
const now = () => new Date().toISOString();
const terminal = new Set(["completed", "failed", "cancelled", "stopped"]);
export function measuredAgentSteps(c:BenchmarkCell){return c.trace?c.trace.events.filter(e=>["tool.call","plan","verify.requested","decision.summary"].includes(e.kind)).length:c.steps;}
const startSchema = z
  .object({
    providerId: z.string().min(1),
    hostId: z.string().min(1),
    sudo: z.boolean().default(false),
    scenarios: z.array(z.number().int().min(1).max(12)).min(1).max(12),
    modes: z.array(z.enum(benchmarkModes)).min(1).max(3),
    basePort: z.number().int().min(1024).max(64000).default(18110),
    maxSteps: z.number().int().min(5).max(100).default(40),
    caseTimeoutSeconds: z.number().int().min(60).max(3600).default(900),
    allowRestart: z.boolean().default(false),
    interactionPolicy:z.enum(["pause","record_failure"]).default("pause"),
  })
  .strict();
export function benchmarkSummary(r: BenchmarkRun) {
  return benchmarkModes.map((mode) => {
    const cells = r.cells.filter((c) => c.mode === mode),
      done = cells.filter((c) => c.phase === "completed"),
      recovery = done.filter((c) => c.scenario >= 9),
      sum = (key: keyof NonNullable<BenchmarkCell["trace"]>["metrics"]) =>
        done.reduce((n, c) => n + (c.trace?.metrics[key] ?? 0), 0);
    return {
      mode,
      total: cells.length,
      evaluated: done.length,
      setupFailures: cells.filter((c) => c.phase === "setup_failed").length,
      environmentBlocks: cells.filter(c=>c.phase==="environment_blocked").length,
      successes: done.filter((c) => c.success).length,
      successRate: done.length
        ? done.filter((c) => c.success).length / done.length
        : null,
      recoverySuccessRate: recovery.length
        ? recovery.filter((c) => c.recoverySuccess).length / recovery.length
        : null,
      meanCompletionMs: done.length
        ? done.reduce(
            (n, c) =>
              n +
              Math.max(0, Date.parse(c.finishedAt!) - Date.parse(c.startedAt!)),
            0,
          ) / done.length
        : null,
      steps: done.reduce((n, c) => n + (measuredAgentSteps(c) ?? 0), 0),
      meanAgentSteps: done.length && done.every(c=>measuredAgentSteps(c)!==undefined) ? done.reduce((n,c)=>n+measuredAgentSteps(c)!,0)/done.length : null,
      toolCalls: sum("toolCalls"),
      toolFailures: sum("toolFailures"),
      modelCalls:
        done.length && done.every((c) => c.trace?.metrics.modelCalls != null)
          ? sum("modelCalls")
          : null,
      inputTokens:
        done.length && done.every((c) => c.trace?.metrics.inputTokens != null)
          ? sum("inputTokens")
          : null,
      outputTokens:
        done.length && done.every((c) => c.trace?.metrics.outputTokens != null)
          ? sum("outputTokens")
          : null,
      totalTokens:
        done.length && done.every((c) => c.trace?.metrics.totalTokens != null)
          ? sum("totalTokens")
          : null,
      approvalRequests: sum("approvalRequests"),
      humanApprovals: sum("humanApprovals"),
      humanInterventionRate: done.length
        ? done.filter((c) => (c.trace?.metrics.humanInterventions ?? 0) > 0)
            .length / done.length
        : null,
      riskBlocks: sum("riskBlocks"),
      verificationFailures: sum("verificationFailures"),
      resumeSuccesses: sum("resumeSuccesses"),
      resumeSuccessRate: done.some(c=>c.trace?.events.some(e=>e.kind==="run.resumed")) ? sum("resumeSuccesses") / done.reduce((n,c)=>n+(c.trace?.events.filter(e=>e.kind==="run.resumed").length??0),0) : null,
      incorrectSuccessClaims: done.filter((c) => c.incorrectSuccessClaim)
        .length,
    };
  });
}
export class BenchmarkService {
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private closing = false;
  private current?: BenchmarkRun;
  private originalExec: Backend["ssh"]["exec"];
  constructor(
    private core: Backend,
    private agent: AgentService,
    private workflow: WorkflowRuntime,
    private traces: ExecutionTraceService,
    private changed: () => void,
    private restart?: () => void,
  ) {
    for (const r of core.store.list<BenchmarkRun>("benchmarkRuns"))
      if (r.status === "running") {
        r.status = "paused";
        r.summary = "后台重启，请继续实验；恢复时仅核实已有Task，不重新提交";
        this.save(r);
      }
    this.originalExec = core.ssh.exec.bind(core.ssh);
    core.ssh.exec = async (host, command, options) => {
      const r =
          this.current?.status === "running"
            ? this.current
            : this.core.store
                .list<BenchmarkRun>("benchmarkRuns")
                .find((r) => r.status === "running" && r.hostId === host),
        c =
          r?.hostId === host
            ? r.cells.find((c) => c.phase === "running")
            : undefined;
      if (
        r &&
        c &&
        [9, 10, 11].includes(c.scenario) &&
        command.includes("SRE_LOG_BEGIN")
      ) {
        const t = this.executionTasks(r,c)
          .find(
            (t) =>
              t.hostId === host &&
              t.id !== c.seedTaskId &&
              t.submitted &&
              t.directory &&
              command.includes(t.directory),
          );
        const limit = c.scenario === 10 ? 6 : 1;
        if (t && c.injections.length < limit) {
          c.injections.push({
            at: now(),
            kind:
              c.scenario === 9
                ? "ssh-transport-close"
                : c.scenario === 10
                  ? "query-error"
                  : "backend-process-restart",
            taskId: t.id,
          });
          this.save(r);
          if (c.scenario === 11) {
            if (!this.restart) throw new Error("未配置后台重启接口");
            r.status = "paused";
            r.summary = "已持久化实验检查点，即将重启后台进程";
            this.save(r);
            this.restart();
            throw new Error("Benchmark后台重启");
          }
          if (c.scenario === 10)
            throw new Error("Benchmark注入：仅当前实验作业查询连接失败");
          return this.originalExec(host, "sleep 1; " + command, {
            ...options,
            disconnectAfterMs: 50,
          });
        }
      }
      return this.originalExec(host, command, options);
    };
  }
  private save(r: BenchmarkRun) {
    r.updatedAt = now();
    this.core.store.put("benchmarkRuns", r);
    this.changed();
  }
  private identity(hostId: string, providerId: string) {
    return workflowHash({
      provider: this.core.store.get("providers", providerId),
      host: this.core.store.get("hosts", hostId),
    });
  }
  private get(id: string) {
    const r =
      this.current?.id === id
        ? this.current
        : this.core.store.get<BenchmarkRun>("benchmarkRuns", id);
    if (!r) throw new Error("Benchmark不存在");
    return r;
  }
  private schedule() {
    if (!this.closing && !this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.tick();
      }, 1000);
  }
  async tick() {
    if (this.busy || this.closing) return;
    this.busy = true;
    try {
      const r = this.core.store
        .list<BenchmarkRun>("benchmarkRuns")
        .find((r) => r.status === "running");
      if (!r) return;
      this.current = r;
      const c = r.cells.find(
        (c) => !["completed", "setup_failed", "environment_blocked"].includes(c.phase),
      );
      if (!c) {
        r.status = "completed";
        r.summary = "实验结束，成功率仅统计已独立验收的样本";
        this.save(r);
        return;
      }
      try {
        if (r.identity !== this.identity(r.hostId, r.providerId))
          throw new Error("主机或模型配置已变化，请保留本轮证据后新建实验");
        if(r.riskEngineVersion&&r.riskEngineVersion!==RiskEngine.version)throw new Error("风险规则版本已变化，请保留本轮结果并新建实验，避免混合版本比较");
        if (c.phase === "pending") {
          c.phase = "preparing";
          c.startedAt = now();
          this.save(r);
          const spec = {
              hostId: r.hostId,
              title: `Benchmark ${c.id} 环境准备`,
              sudo: r.sudo,
              timeout: 120,
              script: fixture(c),
            },
            preview = this.core.tasks.preview(spec);
          c.seedTaskId = this.core.tasks.run(preview.token, spec, {
            source: "ai",
          }).id;
          this.save(r);
          return;
        }
        if (c.phase === "preparing") {
          if (!c.seedTaskId)
            throw new Error(
              "准备阶段缺少Task引用，禁止重复提交，请人工核实隔离目录",
            );
          const t = this.core.store.get<Task>("tasks", c.seedTaskId);
          if (!t) throw new Error("准备Task已丢失");
          if (t.status === "unknown") {
            await this.core.tasks.reconcile(t.id);
            return;
          }
          if (["running", "queued"].includes(t.status)) return;
          if (t.status !== "succeeded") {
            c.phase = "setup_failed";
            c.error = t.logs;
            c.finishedAt = now();
            this.save(r);
            return;
          }
          await this.launch(r, c);
          return;
        }
        if (c.phase === "running") {
          if (!c.sourceId || !c.source)
            throw new Error("执行引用缺失；为防重复执行，禁止自动重发");
          let s = this.state(c);
          if (!s) throw new Error("执行记录丢失；不能重放任务");
          if (terminal.has(s.status)) {
            if(s.status==="failed"&&/API 请求失败（HTTP \d{3}/.test(s.summary)){
              c.phase="environment_blocked";c.error=s.summary;c.trace=this.traces.get(c.source!,c.sourceId!);c.finishedAt=now();c.steps=measuredAgentSteps(c);r.status="paused";r.summary="模型接口不可用，已暂停整个实验；该样本单列为环境阻塞，不计入自主能力成功率。";this.save(r);return;
            }
            c.phase = "evaluating";
            this.save(r);
            return;
          }
          if (Date.now() > Date.parse(c.deadline!)) {
            await this.control(c, "stop");
            r.status = "paused";
            r.summary =
              "案例达到时间上限，已停止后续操作；请核实原作业后继续采集";
            this.save(r);
            return;
          }
          if (c.scenario >= 9 && c.injections.length) {
            if (c.source === "workflow") {
              const w = s as WorkflowRun,
                childId = w.states[w.current]?.agentSessionId;
              if (childId) {
                let child = this.core.store.get<AgentSession>(
                  "aiSessions",
                  childId,
                );
                if (child?.status === "unknown")
                  await this.agent.handle("ai.session.reconcile", {
                    id: childId,
                  });
                child = this.core.store.get<AgentSession>(
                  "aiSessions",
                  childId,
                );
                if (child?.status === "paused")
                  await this.agent.handle("ai.session.resume", { id: childId });
              }
            }
            s = this.state(c)!;
            if (s.status === "unknown") await this.control(c, "reconcile");
            s = this.state(c)!;
            if (
              s.status === "paused" ||
              (c.source === "workflow" && s.status === "awaiting_agent")
            )
              await this.control(c, "resume");
          }
          s = this.state(c)!;
          const child =
            c.source === "workflow"
              ? this.core.store.get<AgentSession>(
                  "aiSessions",
                  (s as WorkflowRun).states[(s as WorkflowRun).current]
                    ?.agentSessionId ?? "",
                )
              : undefined;
          if (
            ["awaiting_approval", "awaiting_input", "paused"].includes(
              s.status,
            ) ||
            (child &&
              ["awaiting_approval", "awaiting_input"].includes(child.status))
          ) {
            if(r.interactionPolicy==="record_failure"){
              c.error=`自主样本需要外部介入：${child?.summary??s.summary}`;
              await this.control(c,"stop");c.phase="evaluating";
            }else{r.status = "paused";
            r.summary = "执行等待审批或输入，请在AI助手/Workflow处理后继续实验";}
            this.save(r);
          }
          return;
        }
        if (c.phase === "evaluating") {
          const result = await this.originalExec(r.hostId, verification(c), {
            sudo: r.sudo,
            timeout: 15000,
          });
          if (c.scenario >= 9) {
            const jobs = this.executionTasks(r,c);
            const tasksValid =
              jobs.length === 1 &&
              (c.scenario === 12
                ? jobs[0].status === "failed"
                : jobs[0].status === "succeeded");
            result.stdout += `\nPersistent Task evidence: ${JSON.stringify(jobs.map((t) => ({ id: t.id, status: t.status, exitCode: t.exitCode })))}`;
            if (!tasksValid) {
              result.code = 1;
              result.stderr += "\n持久作业必须恰好提交一次且终态符合预期";
            }
          }
          c.evidence = { at: now(), ...result };
          c.trace = this.traces.get(c.source!, c.sourceId!);
          c.claimedSuccess = c.trace.status === "completed";
          c.steps = measuredAgentSteps(c);
          const injected =
            c.scenario < 9 ||
            c.scenario === 12 ||
            c.injections.length >= (c.scenario === 10 ? 6 : 1);
          c.success = c.claimedSuccess && result.code === 0 && injected;
          c.incorrectSuccessClaim = c.claimedSuccess && result.code !== 0;
          c.recoverySuccess = c.scenario >= 9 ? c.success : undefined;
          c.phase = "completed";
          c.finishedAt = now();
          this.save(r);
          return;
        }
      } catch (error) {
        r.status = "paused";
        r.summary = error instanceof Error ? error.message : String(error);
        c.error = this.core.store.redact(r.summary);
        this.save(r);
      }
    } finally {
      this.current = undefined;
      this.busy = false;
      if (
        this.core.store
          .list<BenchmarkRun>("benchmarkRuns")
          .some((r) => r.status === "running")
      )
        this.schedule();
    }
  }
  private executionTasks(r:BenchmarkRun,c:BenchmarkCell){
    const s=this.state(c),sessions=c.source==="agent"?(s?[s as AgentSession]:[]):Object.values((s as WorkflowRun|undefined)?.states??{}).flatMap(n=>{const child=n.agentSessionId?this.core.store.get<AgentSession>("aiSessions",n.agentSessionId):undefined;return child?[child]:[];});
    const owned=new Set(sessions.flatMap(s=>s.steps.flatMap(step=>step.taskId?[step.taskId]:[])));
    const jobs=this.core.store.list<any>("tasks").filter(t=>owned.has(t.id)&&t.hostId===r.hostId&&t.submitted&&String(t.logs??"").split(/\r?\n/).some(line=>line===`SRE_BENCH_EXEC:${c.id}`));
    const ids=[...new Set([...(c.executionTaskIds??[]),...jobs.map(t=>t.id)])];if(JSON.stringify(ids)!==JSON.stringify(c.executionTaskIds??[])){c.executionTaskIds=ids;this.save(r);}
    return ids.flatMap(id=>{const t=this.core.store.get<any>("tasks",id);return t&&owned.has(id)&&t.hostId===r.hostId?[t]:[];});
  }
  private state(c: BenchmarkCell) {
    return this.core.store.get<AgentSession | WorkflowRun>(
      c.source === "workflow" ? "workflowRuns" : "aiSessions",
      c.sourceId!,
    );
  }
  private control(c: BenchmarkCell, action: string) {
    return c.source === "workflow"
      ? this.workflow.handle(`studio.workflow.${action}`, { id: c.sourceId })
      : this.agent.handle(`ai.session.${action}`, { id: c.sourceId });
  }
  private async launch(r: BenchmarkRun, c: BenchmarkCell) {
    const target = {
        kind: "ssh" as const,
        hostId: r.hostId,
        root: c.root,
        sudo: r.sudo,
      },
      prompt = instruction(c),
      skillId = c.scenario <= 3 ? "application-deployment" : "incident-repair";
    c.deadline = new Date(
      Date.now() + r.caseTimeoutSeconds * 1000,
    ).toISOString();
    if (c.mode !== "C") {
      c.source = "agent";
      c.sourceId = randomUUID();
      c.phase = "running";
      this.save(r);
      await this.agent.handle(
        "ai.session.start",
        {
          providerId: r.providerId,
          target,
          permission: "autonomous",
          instruction: prompt,
          maxSteps: r.maxSteps,
          skillMode: c.mode === "A" ? "none" : skillId,
        },
        undefined,
        c.sourceId,
      );
    } else {
      const a = this.core.agentBuilder.save({
        name: `Benchmark ${c.id}`,
        description: "独立A/B/C实验的固定Agent定义",
        icon: "🧪",
        category: "Benchmark",
        providerId: r.providerId,
        permissionCeiling: "autonomous",
        riskPolicy: "autonomous",
        toolIds: this.core.toolRegistry
          .list()
          .filter((t) => t.enabled && t.source === "builtin")
          .map((t) => t.id),
        skillIds: [skillId],
        maxSteps: r.maxSteps,
        maxRuntimeSeconds: r.caseTimeoutSeconds,
        targetHostIds: [r.hostId],
        rootPrefix: c.root,
        acceptanceCriteria: ["实际独立验证通过，恢复场景不得重复执行"],
        enabled: true,
      });
      c.agentId = a.id;
      const verify =
        c.scenario >= 9
          ? {
              tool: "verify_file",
              arguments: {
                path:
                  c.root + (c.scenario === 12 ? "/count.txt" : "/result.json"),
                expectText: c.scenario === 12 ? "1" : "ready",
              },
            }
          : {
              tool: "verify_service",
              arguments: {
                url: `http://127.0.0.1:${c.port}/`,
                expectText: "benchmark-ready",
              },
            };
      const nodes: WorkflowNode[] = [
        {
          id: "start",
          type: "Start",
          label: "开始",
          x: 20,
          y: 40,
          config: {},
          next: "skill",
        },
        {
          id: "skill",
          type: "Skill",
          label: "SRE技能",
          x: 220,
          y: 40,
          config: { skillId },
          next: "agent",
        },
        {
          id: "agent",
          type: "Agent",
          label: "执行任务",
          x: 420,
          y: 40,
          config: { agentId: a.id, instruction: prompt },
          next: "verify",
        },
        {
          id: "verify",
          type: "Verify",
          label: "独立验收",
          x: 620,
          y: 40,
          config: verify,
          next: "end",
        },
        { id: "end", type: "End", label: "结束", x: 820, y: 40, config: {} },
      ];
      const w = this.core.workflowRegistry.save({
        name: `Benchmark ${c.id}`,
        description: "固定Agent/Skill/Risk/Verify/Recovery工作流",
        nodes,
      });
      c.workflowId = w.id;
      c.source = "workflow";
      c.sourceId = randomUUID();
      c.phase = "running";
      this.save(r);
      await this.workflow.startPrepared(
        {
          id: w.id,
          target,
          permission: "autonomous",
          input: {},
          maxRuntimeSeconds: r.caseTimeoutSeconds,
        },
        c.sourceId,
      );
    }
    if (r.status === "stopped" && c.sourceId) await this.control(c, "stop");
  }
  async handle(method: string, input: unknown = {}) {
    if (method === "studio.benchmark.list") {
      z.object({}).strict().parse(input);
      return this.core.store
        .list<BenchmarkRun>("benchmarkRuns")
        .map((r) => ({
          ...r,
          cells: r.cells.map(({ trace, ...c }) => c),
          statistics: benchmarkSummary(r),
        }))
        .reverse();
    }
    if (method === "studio.benchmark.start") {
      const p = startSchema.parse(input);
      if (
        new Set(p.scenarios).size !== p.scenarios.length ||
        new Set(p.modes).size !== p.modes.length
      )
        throw new Error("实验场景/模式不能重复");
      if (
        this.core.store
          .list<BenchmarkRun>("benchmarkRuns")
          .some((r) => ["running", "paused"].includes(r.status))
      )
        throw new Error("请先完成或停止现有实验");
      const host = this.core.store.get<Host>("hosts", p.hostId),
        provider = this.core.store.get<AIProvider>("providers", p.providerId);
      if (!host?.fingerprint || provider?.kind !== "model")
        throw new Error("请选择已验证SSH主机和模型API");
      if (host.username !== "root" && !p.sudo)
        throw new Error("隔离服务准备需要root或已有sudo配置");
      if (this.core.tasks.hasPendingWork([p.hostId]))
        throw new Error("目标主机存在运行或未知任务，请先核实");
      if (p.scenarios.includes(11) && (!p.allowRestart || !this.restart))
        throw new Error("后台重启场景需要显式启用重启测试");
      const id = randomUUID(),
        cells: BenchmarkCell[] = [];
      for (const scenario of p.scenarios)
        for (const mode of p.modes) {
          const key = `${scenario}-${mode}`;
          cells.push({
            id: `${id}/${key}`,
            scenario,
            mode,
            root: `/opt/sre-benchmark/${id}/${key}`,
            unit: `srebench-${id.slice(0, 8)}-${scenario}-${mode.toLowerCase()}.service`,
            project: `srebench-${id.slice(0, 8)}-${scenario}-${mode.toLowerCase()}`,
            port: p.basePort + cells.length * 2,
            phase: "pending",
            injections: [],
          });
        }
      const r: BenchmarkRun = {
        schemaVersion: 1,
        id,
        createdAt: now(),
        updatedAt: now(),
        status: "running",
        providerId: p.providerId,
        hostId: p.hostId,
        sudo: p.sudo,
        identity: this.identity(p.hostId, p.providerId),
        model: provider.model ?? "",
        protocol: provider.protocol ?? "openai",
        maxSteps: p.maxSteps,
        caseTimeoutSeconds: p.caseTimeoutSeconds,
        allowRestart: p.allowRestart,
        interactionPolicy:p.interactionPolicy,
        riskEngineVersion:RiskEngine.version,
        cells,
        summary: "隔离真实实验已开始",
      };
      this.save(r);
      this.schedule();
      return r;
    }
    const p = z
        .object({
          id: z.string(),
          format: z.enum(["json", "csv", "markdown"]).optional(),
        })
        .strict()
        .parse(input),
      r = this.get(p.id);
    if (method === "studio.benchmark.get")
      return { ...r, statistics: benchmarkSummary(r) };
    if (method === "studio.benchmark.export") {
      if (!p.format) throw new Error("请选择导出格式");
      const file = await this.core.handle("dialog.open", { mode: "save" });
      if (!file) return null;
      const stats = benchmarkSummary(r),
        csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const content =
        p.format === "json"
          ? JSON.stringify({ ...r, cells:r.cells.map(c=>({...c,steps:measuredAgentSteps(c)})), statistics: stats }, null, 2)
          : p.format === "csv"
            ? [
                [
                  "scenario",
                  "mode",
                  "phase",
                  "success",
                  "claimedSuccess",
                  "incorrectSuccessClaim",
                  "verificationCode",
                  "sourceId",
                  "steps",
                  "toolCalls",
                  "toolFailures",
                  "modelCalls",
                  "inputTokens",
                  "outputTokens",
                  "totalTokens",
                  "approvalRequests",
                  "humanApprovals",
                  "humanInterventions",
                  "riskBlocks",
                  "verificationFailures",
                  "recoveryAttempts",
                  "resumeSuccesses",
                  "elapsedMs",
                ],
                ...r.cells.map((c) => [
                  c.scenario,
                  c.mode,
                  c.phase,
                  c.success,
                  c.claimedSuccess,
                  c.incorrectSuccessClaim,
                  c.evidence?.code,
                  c.sourceId,
                  measuredAgentSteps(c),
                  ...(
                    [
                      "toolCalls",
                      "toolFailures",
                      "modelCalls",
                      "inputTokens",
                      "outputTokens",
                      "totalTokens",
                      "approvalRequests",
                      "humanApprovals",
                      "humanInterventions",
                      "riskBlocks",
                      "verificationFailures",
                      "recoveryAttempts",
                      "resumeSuccesses",
                      "elapsedMs",
                    ] as const
                  ).map((k) => c.trace?.metrics[k]),
                ]),
              ]
                .map((row) => row.map(csv).join(","))
                .join("\n")
            : `# SRE Agent Benchmark\n\n实验 ${r.id}，模型 ${r.model} (${r.protocol})。\n\nA：通用Agent，无Skill；B：SRE Skill + Plan；C：Agent Builder + Workflow + Risk + Verify。三组保留相同平台安全约束。\n\n已评估样本是成功率分母，setup_failed和待执行样本不计入。null表示未采集。\n\n\`\`\`json\n${JSON.stringify(stats, null, 2)}\n\`\`\`\n\n${r.cells.map((c) => `- 场景${c.scenario} ${c.mode}：${c.phase}；成功=${c.success ?? "未评估"}；Trace=${c.sourceId ?? "无"}；独立验证=${c.evidence?.stdout ?? "未执行"}`).join("\n")}\n\n完整事件和原始验证证据请同时导出JSON。\n`;
      await fs.writeFile(
        String(file),
        this.core.store.redact(content, { shortSecrets: "contextual" }),
        { encoding: "utf8", mode: 0o600 },
      );
      return { saved: true };
    }
    if (method === "studio.benchmark.pause") {
      r.status = "paused";
      r.summary = "实验调度暂停，当前远端作业仍保留，请在执行界面管理";
      this.save(r);
      return r;
    }
    if (method === "studio.benchmark.resume") {
      if (r.status !== "paused") throw new Error("只有暂停的实验可以继续");
      r.status = "running";
      r.summary = "继续原实验并核实检查点";
      this.save(r);
      this.schedule();
      return r;
    }
    if (method === "studio.benchmark.stop") {
      r.status = "stopped";
      r.summary = "实验已停止；保留目录、服务与证据，不撤销远端变更";
      this.save(r);
      const c = r.cells.find((c) => c.phase === "running");
      if (c?.sourceId && this.state(c)) await this.control(c, "stop");
      return r;
    }
    throw new Error("不支持的Benchmark操作");
  }
  close() {
    this.closing = true;
    clearTimeout(this.timer);
    this.core.ssh.exec = this.originalExec;
  }
}
