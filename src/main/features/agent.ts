import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { skillModes, selectSreSkills } from "../../shared/sre-skills";
import { isSreTool } from "./agent-sre-tools";
import type { MonitoringStack } from "../../shared/types";
import type { Backend } from "../core/backend";
import type { AIProvider, AppEvent } from "../../shared/types";
import type {
  AgentSession,
  AgentStep,
  AgentToolCall,
} from "../../shared/agent";
import { AIService, sanitizeContext } from "./ai";
import { AgentTools, UncertainExecution } from "./agent-tools";
import {
  AgentReplyError,
  agentSystemPrompt,
  autonomousPrompt,
  isMutation,
  permissionSchema,
  targetSchema,
  toolDecision,
} from "./agent-contract";

import { planSchema, completionEvidence } from "./agent-execution";

interface StoredSession extends AgentSession {
  identity: string;
}
interface ActiveRun {
  session: StoredSession;
  pauseRequested?: boolean;
  controller: AbortController;
  job?: Promise<void>;
  pending?: {
    stepId: string;
    call: AgentToolCall;
    resolve: (approved: boolean) => void;
  };
}
const idSchema = z.object({ id: z.string().min(1).max(100) }).strict();
const busyStatuses = ["running", "pausing", "awaiting_approval"];
const now = () => new Date().toISOString();

export class AgentService {
  private active = new Map<string, ActiveRun>();
  private tools: AgentTools;
  private closing = false;
  private recovering = new Set<string>();
  constructor(
    private core: Backend,
    private ai: AIService,
    private emit: (event: AppEvent) => void,
  ) {
    this.tools = new AgentTools(core);
    for (const s of core.store.list<StoredSession>("aiSessions")) {
      for (const step of s.steps) {
        if (!step.taskId) continue;
        const task = core.store.get<any>("tasks", step.taskId);
        if (task && task.source !== "ai")
          core.store.put("tasks", { ...task, source: "ai" });
      }
      if (busyStatuses.includes(s.status)) {
        for (const step of s.steps)
          if (step.status === "running" && step.call && isMutation(step.call))
            step.uncertain = true;
        s.status = "unknown";
        s.summary =
          "软件已重启，原任务已暂停。请核实命令、文件和关联远端任务；不会自动重放操作。";
        this.save(s);
      }
    }
  }
  private clean(text: string) {
    return this.core.store.redact(sanitizeContext(text), {
      shortSecrets: "contextual",
    });
  }
  private cleanValue(value: unknown): unknown {
    if (typeof value === "string") return this.clean(value);
    if (Array.isArray(value)) return value.map((item) => this.cleanValue(item));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.cleanValue(item),
        ]),
      );
    return value;
  }
  private save(session: StoredSession) {
    session.updatedAt = now();
    this.core.store.put("aiSessions", session);
    this.emit({ type: "changed" });
  }
  private get(id: string) {
    const s = this.core.store.get<StoredSession>("aiSessions", id);
    if (!s) throw new Error("AI 任务不存在");
    return s;
  }
  private public(s: StoredSession): AgentSession {
    const { identity, ...result } = s;
    return result;
  }
  private identity(session: Pick<AgentSession, "providerId" | "target">) {
    const provider = this.core.store.get<AIProvider>(
      "providers",
      session.providerId,
    );
    if (!provider || provider.kind !== "model")
      throw new Error(
        "请在设置中配置并选择模型 API，自主任务不使用外部 HTTP Agent v1",
      );
    const host =
      session.target.kind === "ssh"
        ? this.core.ssh.host(session.target.hostId)
        : null;
    return createHash("sha256")
      .update(JSON.stringify({ provider, host }))
      .digest("hex");
  }
  async handle(method: string, params: unknown = {}): Promise<unknown> {
    if (this.closing) throw new Error("软件正在退出");
    if (method === "ai.session.list") {
      z.object({}).strict().parse(params);
      return this.core.store
        .list<StoredSession>("aiSessions")
        .map((s) => ({
          ...this.public(s),
          steps: [],
          stepCount: s.steps.length,
        }))
        .reverse();
    }
    if (method === "ai.session.get")
      return this.public(this.get(idSchema.parse(params).id));
    if (method === "ai.session.reconcile") {
      const s = this.get(idSchema.parse(params).id);
      if (s.status !== "unknown" || this.active.size || this.recovering.size)
        throw new Error("请先结束运行中的会话，仅待核实会话可恢复");
      if (s.target.kind !== "ssh") throw new Error("本机中断仍需人工核实");
      if (this.identity(s) !== s.identity)
        throw new Error("模型或主机配置已变化，不能恢复到新目标");
      this.recovering.add(s.id);
      try {
        let unresolved = false;
        for (const step of s.steps) {
          if (step.taskId) {
            const stored = this.core.store.get<any>("tasks", step.taskId);
            if (
              !stored ||
              stored.hostId !== s.target.hostId ||
              stored.source !== "ai"
            ) {
              unresolved = true;
              continue;
            }
            const task = await this.core.tasks.reconcile(step.taskId);
            if (["running", "queued", "unknown"].includes(task.status)) {
              unresolved = true;
              continue;
            }
            step.status = task.status === "succeeded" ? "succeeded" : "failed";
            step.uncertain = false;
            step.finishedAt = task.updatedAt ?? now();
            step.output = JSON.stringify({
              taskId: task.id,
              status: task.status,
              code: task.exitCode ?? (task.status === "succeeded" ? 0 : 1),
              stdout: this.clean(task.logs ?? "").slice(-100000),
              recovered: true,
            });
          } else if (
            step.uncertain ||
            ((step.status === "running" ||
              (step.status === "failed" && step.uncertain !== false)) &&
              step.call &&
              isMutation(step.call))
          ) {
            unresolved = true;
          } else if (["pending", "running"].includes(step.status)) {
            step.status = "rejected";
            step.output =
              "中断前未取得结果；只读观测可重新查询，未开始的操作未重放。";
          }
        }
        if (
          this.closing ||
          this.get(s.id).status !== "unknown" ||
          this.identity(s) !== s.identity
        )
          throw new Error("会话或目标状态已变化，未自动恢复");
        s.status = unresolved ? "unknown" : "paused";
        s.summary = unresolved
          ? "仍有远端作业运行或结果不确定，请检查关联作业和文件后再次核实；未重放命令。"
          : "远端结果已同步，检查点已恢复。点击继续后由模型依据现有结果处理；恢复过程未重新提交命令，仍需业务验收。";
        this.save(s);
        return this.public(s);
      } finally {
        this.recovering.delete(s.id);
      }
    }
    if (method === "ai.session.rename") {
      const p = z
        .object({ id: z.string(), title: z.string().trim().min(1).max(80) })
        .strict()
        .parse(params);
      const s = this.active.get(p.id)?.session ?? this.get(p.id);
      s.title = this.clean(p.title);
      this.save(s);
      return this.public(s);
    }
    if (method === "ai.session.pause") {
      const { id } = idSchema.parse(params),
        run = this.active.get(id);
      const s = run?.session ?? this.get(id);
      if (run) {
        run.pauseRequested = true;
        s.status = "pausing";
        s.summary = "当前操作结束后暂停；不会启动下一项操作";
        this.save(s);
        run.pending?.resolve(false);
        run.pending = undefined;
      } else if (s.status === "awaiting_input") {
        s.status = "paused";
        s.summary = "已暂停，保留当前上下文";
        this.save(s);
      } else if (s.status !== "paused") throw new Error("当前会话不能暂停");
      return this.public(s);
    }
    if (method === "ai.session.resume") {
      const s = this.get(idSchema.parse(params).id);
      if (
        s.target.kind === "local" &&
        this.core.store
          .list<StoredSession>("aiSessions")
          .some(
            (other) =>
              other.target.kind === "local" && other.status === "unknown",
          )
      )
        throw new Error("存在待核实的本机任务，请先核实实际状态");
      if (s.status !== "paused" || this.active.size || this.recovering.size)
        throw new Error("请等待任务暂停完成，并结束其他运行中的会话");
      if (this.identity(s) !== s.identity)
        throw new Error("模型或主机配置已变化，请新建任务");
      if (s.steps.length >= 200)
        throw new Error("会话已达到 200 步上限，请新建任务");
      s.status = "running";
      s.summary = "从已有结果继续";
      this.save(s);
      this.launch(s);
      return this.public(s);
    }
    if (method === "ai.session.start") {
      const p = z
        .object({
          providerId: z.string().min(1),
          permission: permissionSchema,
          skillMode: z.enum(skillModes).default("auto"),
          target: targetSchema,
          instruction: z.string().trim().min(1).max(30000),
          maxSteps: z.number().int().min(1).max(100).default(40),
        })
        .strict()
        .parse(params);
      const target = await this.tools.validateTarget(p.target);
      if (this.closing) throw new Error("软件正在退出，未启动任务");
      // One active AI session globally also prevents competing local command runs.
      if (this.active.size || this.recovering.size)
        throw new Error("请先结束当前 AI 任务，再开始另一个任务");
      if (
        target.kind === "local" &&
        this.core.store
          .list<StoredSession>("aiSessions")
          .some((s) => s.target.kind === "local" && s.status === "unknown")
      )
        throw new Error(
          "存在待核实的本机任务，请检查进程和文件后将该任务标记为已核实",
        );
      const session: StoredSession = {
        ...p,
        target,
        executionVersion: target.kind === "ssh" ? 1 : undefined,
        turnStart: 0,
        activeInstruction: this.clean(p.instruction),
        skills:
          target.kind === "ssh"
            ? selectSreSkills(p.skillMode, p.instruction)
            : [],
        instruction: this.clean(p.instruction),
        title: this.clean(p.instruction).slice(0, 80),
        id: randomUUID(),
        identity: this.identity(p),
        status: "running",
        createdAt: now(),
        updatedAt: now(),
        steps: [],
        summary: "正在理解任务",
        verification: [],
      };
      this.save(session);
      this.launch(session);
      return this.public(session);
    }
    if (method === "ai.session.approve") {
      const p = z
        .object({ id: z.string(), stepId: z.string(), approved: z.boolean() })
        .strict()
        .parse(params);
      const run = this.active.get(p.id),
        s = this.get(p.id);
      if (
        !run?.pending ||
        run.pending.stepId !== p.stepId ||
        s.status !== "awaiting_approval"
      )
        throw new Error("确认已失效或步骤已变化");
      if (this.identity(s) !== s.identity)
        throw new Error("模型或主机配置已变化，请停止并重新创建任务");
      const pending = run.pending;
      run.pending = undefined;
      pending.resolve(p.approved);
      return true;
    }
    if (method === "ai.session.reply") {
      const p = z
        .object({
          id: z.string(),
          instruction: z.string().trim().min(1).max(30000),
        })
        .strict()
        .parse(params);
      const s = this.get(p.id);
      if (
        ![
          "paused",
          "awaiting_input",
          "completed",
          "failed",
          "cancelled",
        ].includes(s.status) ||
        this.active.size ||
        this.recovering.size
      )
        throw new Error("请等待当前任务结束；待核实任务不能自动继续");
      if (
        s.target.kind === "local" &&
        this.core.store
          .list<StoredSession>("aiSessions")
          .some(
            (other) =>
              other.target.kind === "local" && other.status === "unknown",
          )
      )
        throw new Error("请先核实未知的本机任务");
      if (this.identity(s) !== s.identity)
        throw new Error("模型或主机配置已变化，请新建任务");
      const preserveOldReply =
        s.status === "completed" &&
        s.summary &&
        s.steps.at(-1)?.summary !== "助手回复";
      if (s.steps.length + (preserveOldReply ? 1 : 0) >= 200)
        throw new Error("会话已达到 200 步上限，请新建任务");
      if (preserveOldReply)
        s.steps.push({
          id: randomUUID(),
          createdAt: s.updatedAt,
          summary: "助手回复",
          output: s.summary,
          status: "succeeded",
        });
      s.steps.push({
        id: randomUUID(),
        createdAt: now(),
        summary: "用户补充",
        output: this.clean(p.instruction),
        status: "succeeded",
      });
      if (s.status === "completed") {
        s.turnStart = s.steps.length;
        s.activeInstruction = this.clean(p.instruction);
        s.plan = undefined;
        if (s.skillMode === "auto") {
          const previous = s.skillHistory ?? [
            { fromStep: 0, skills: s.skills ?? [] },
          ];
          s.skills = selectSreSkills("auto", p.instruction);
          s.skillHistory = [
            ...previous,
            { fromStep: s.turnStart, skills: s.skills },
          ];
        }
      }
      s.status = "running";
      s.summary = "继续处理用户需求";
      s.verification = [];
      this.save(s);
      this.launch(s);
      return this.public(s);
    }
    if (method === "ai.session.stop") {
      const s = this.get(idSchema.parse(params).id);
      const run = this.active.get(s.id);
      if (run) {
        run.controller.abort();
        run.pending?.resolve(false);
        run.pending = undefined;
      } else if (["awaiting_input", "paused"].includes(s.status)) {
        s.status = "cancelled";
        s.summary = "用户已停止任务";
        this.save(s);
      }
      return true;
    }
    if (method === "ai.session.resolve") {
      const s = this.get(idSchema.parse(params).id);
      if (s.status !== "unknown" || this.active.has(s.id))
        throw new Error("当前任务不是可核实状态");
      if (
        s.target.kind === "ssh" &&
        this.core.tasks.hasPendingWork([s.target.hostId])
      )
        throw new Error(
          "请先在本会话执行记录核实远端操作；其他运维任务请到任务中心核实",
        );
      s.status = "cancelled";
      s.summary += "\n用户已确认核实实际状态，结束本次任务。";
      this.save(s);
      return true;
    }
    if (method === "ai.session.delete") {
      const s = this.get(idSchema.parse(params).id);
      if (
        this.active.has(s.id) ||
        ["unknown", "awaiting_input"].includes(s.status)
      )
        throw new Error("请先停止或核实任务");
      this.core.store.remove("aiSessions", s.id);
      this.emit({ type: "changed" });
      return true;
    }
    throw new Error("不支持的 AI 会话操作");
  }
  private launch(session: StoredSession) {
    const run: ActiveRun = { controller: new AbortController(), session };
    this.active.set(session.id, run);
    run.job = this.loop(session, run).finally(() => {
      this.active.delete(session.id);
      this.emit({ type: "changed" });
    });
  }
  private async loop(s: StoredSession, run: ActiveRun) {
    const signal = run.controller.signal;
    let formatFailures = 0;
    const cycleStart = s.steps.length;
    const pauseAtBoundary = () => {
      if (!run.pauseRequested || signal.aborted) return false;
      s.status = "paused";
      s.summary = "已暂停，保留已完成操作；继续时从现有结果接着处理。";
      this.save(s);
      return true;
    };
    try {
      for (let turn = 0; turn < s.maxSteps && s.steps.length < 200; turn++) {
        if (signal.aborted) throw new Error("任务已停止");
        if (pauseAtBoundary()) return;
        const attempts = s.steps
          .slice(cycleStart)
          .filter((item) => item.call && item.call.tool !== "update_plan")
          .slice(-3);
        if (
          attempts.length === 3 &&
          attempts.every((item) => ["failed", "rejected"].includes(item.status))
        ) {
          s.status = "awaiting_input";
          s.summary =
            "连续三次操作失败或被拒绝，已暂停并保留现场，请检查原因后继续。";
          this.save(s);
          return;
        }
        if (this.identity(s) !== s.identity)
          throw new Error("模型或目标主机配置已变化，请新建任务");
        s.summary = "正在分析下一步";
        this.save(s);
        const context = JSON.stringify({
          instruction: s.instruction,
          plan: s.plan,
          executionHistory: s.steps
            .filter(
              (step) =>
                step.call &&
                (isMutation(step.call) ||
                  step.call.tool === "verify_service" ||
                  step.call.tool === "verify_file" ||
                  step.call.tool === "verify_package" ||
                  step.call.tool === "http_check"),
            )
            .slice(-60)
            .map((step) => ({
              id: step.id,
              tool: step.call!.tool,
              arguments:
                step.call!.tool === "write_file"
                  ? { path: step.call!.arguments.path }
                  : step.call!.arguments,
              status: step.status,
              taskId: step.taskId,
              summary: step.summary,
              output: step.output?.slice(-1500),
            })),
          monitoringPlans:
            s.target.kind === "ssh"
              ? this.core.store
                  .list<MonitoringStack>("monitoring")
                  .filter(
                    (m) =>
                      s.target.kind === "ssh" && m.hostId === s.target.hostId,
                  )
                  .map((m) => ({
                    id: m.id,
                    name: this.clean(m.name),
                    grafanaPort: m.grafanaPort ?? 3000,
                    prometheusPort: m.prometheusPort ?? 9090,
                  }))
              : [],
          diagnosticEvidence: s.steps
            .filter((step) => step.call && isSreTool(step.call.tool))
            .slice(-12)
            .map((step) => ({
              id: step.id,
              tool: step.call!.tool,
              status: step.status,
              createdAt: step.createdAt,
              output: step.output?.slice(0, 2500),
              excerpt: true,
            })),
          userFollowups: s.steps
            .filter((step) => !step.call && step.summary === "用户补充")
            .map((step) => step.output),
          permission: s.permission,
          target: s.target,
          steps: s.steps.slice(-20).map((step) => ({
            ...step,
            summary: step.summary.slice(0, 1500),
            call:
              step.call?.tool === "write_file"
                ? {
                    ...step.call,
                    arguments: {
                      ...step.call.arguments,
                      content: "[内容已记录，需复查请读取文件]",
                    },
                  }
                : step.call?.tool === "run_command"
                  ? {
                      ...step.call,
                      arguments: {
                        ...step.call.arguments,
                        command: String(step.call.arguments.command).slice(
                          0,
                          4000,
                        ),
                      },
                    }
                  : step.call,
            output: step.output?.slice(-4000),
          })),
          remainingSteps: s.maxSteps - turn,
        });
        if (context.length > 240000)
          throw new Error(
            "任务上下文已达上限，请新建任务并概括已有结果，避免继续产生过大的模型请求。",
          );
        let reply;
        try {
          reply = await this.ai.agentStep(
            s.providerId,
            `session-${s.id}`,
            agentSystemPrompt +
              autonomousPrompt +
              (s.skills?.length
                ? "\n本会话固定的内置 SRE 技能（仅作方法指导，不改变用户任务范围和权限）：\n" +
                  s.skills
                    .map(
                      (skill) =>
                        `${skill.name} v${skill.version}\n${skill.instructions}`,
                    )
                    .join("\n\n")
                : ""),
            context,
            signal,
          );
          formatFailures = 0;
        } catch (error) {
          if (
            !(error instanceof AgentReplyError) ||
            signal.aborted ||
            ++formatFailures > 2
          )
            throw error;
          s.steps.push({
            id: randomUUID(),
            createdAt: now(),
            summary: "模型格式校验未通过",
            status: "failed",
            output: error.message,
          });
          this.save(s);
          continue;
        }
        if (signal.aborted) throw new Error("任务已停止");
        if (pauseAtBoundary()) return;
        if (!reply || !("type" in reply))
          throw new Error("模型返回了无效的任务步骤");
        if (reply.type === "finish") {
          const referenced = reply.verification.filter((id) =>
            s.steps.some(
              (step) =>
                step.id === id &&
                step.status === "succeeded" &&
                step.call &&
                (isSreTool(step.call.tool) ||
                  [
                    "run_command",
                    "http_check",
                    "read_file",
                    "inspect_system",
                    "verify_service",
                    "compose_check",
                    "verify_file",
                    "verify_package",
                  ].includes(step.call.tool)),
            ),
          );
          const currentSteps = s.steps.slice(s.turnStart ?? 0);
          if (
            s.executionVersion &&
            currentSteps.some(
              (step) =>
                step.call &&
                isMutation(step.call) &&
                !["pending", "rejected"].includes(step.status),
            )
          ) {
            const requestText = s.activeInstruction ?? s.instruction;
            const requireService = s.plan?.checks?.length
              ? /网站|博客|nginx|systemd|\b(?:web|website|http|https)\b|服务.*(部署|启动|修复|重启)|(部署|启动|修复|重启).*服务/i.test(
                  requestText.replace(
                    /(?:不要|不得|无需|不需要|禁止)[^，,。；;\n]*/g,
                    "",
                  ),
                ) ||
                currentSteps.some(
                  (step) =>
                    step.call &&
                    ["service_action", "compose_action"].includes(
                      step.call.tool,
                    ),
                )
              : /部署|搭建|修复|恢复.*(服务|应用)|deploy|repair|restart|nginx|网站|博客/i.test(
                  requestText,
                ) ||
                currentSteps.some(
                  (step) => step.call?.tool === "run_command",
                ) ||
                s.skills?.some((skill) =>
                  ["application-deployment", "incident-repair"].includes(
                    skill.id,
                  ),
                ) ||
                currentSteps.some(
                  (step) =>
                    step.call &&
                    ["service_action", "compose_action"].includes(
                      step.call.tool,
                    ),
                );
            const fresh = completionEvidence(
              currentSteps,
              referenced,
              !!requireService,
              s.plan?.checks,
            );
            if (!fresh.length) {
              const lastChange = [...currentSteps]
                .reverse()
                .find(
                  (step) =>
                    step.call &&
                    isMutation(step.call) &&
                    !["pending", "rejected"].includes(step.status),
                );
              s.steps.push({
                id: randomUUID(),
                createdAt: now(),
                summary: "验收未通过",
                status: "failed",
                output:
                  `本次 finish 未引用有效的后置验收。最后一个可能变更步骤为 ${lastChange?.id}（${lastChange?.call?.tool}）。run_command 即使命令只读也视为可能变更，会使此前验收失效。` +
                  (s.plan?.checks?.length
                    ? "必须在最后变更后逐项执行以下已锁定checks中的相同工具与参数（包括path），全部成功并引用每一项新步骤ID：" +
                      JSON.stringify(s.plan.checks) +
                      "。若计划路径与实际产物不同，必须明确报告差异并停止交付；不能为凑验收创建无关副本或降低检查。"
                    : "") +
                  (requireService
                    ? "下一步调用 verify_service 或 http_check，成功后引用该新步骤ID。"
                    : s.plan?.checks?.length
                      ? "请执行计划中的verify_file/verify_package。"
                      : "下一步调用 read_file、compose_check、verify_service 或 http_check 复核，成功后引用该新步骤ID。") +
                  "不要重复提交 finish 或再次用 run_command 补做最终检查；服务状态/端口请用 service_status/network_listeners。若已有上述最后变更之后的成功验收，只需引用其真实ID。不能验证时用 question 说明阻碍。",
              });
              if (
                s.steps
                  .slice(s.turnStart ?? 0)
                  .filter((step) => step.summary === "验收未通过")
                  .slice(-3).length >= 3
              ) {
                s.status = "awaiting_input";
                s.summary =
                  "多次请求完成但缺少变更后验收，已暂停。请检查记录后继续。";
                this.save(s);
                return;
              }
              this.save(s);
              continue;
            }
            referenced.splice(0, referenced.length, ...fresh);
          }
          s.verification = referenced;
          s.status = "completed";
          s.summary =
            this.clean(reply.summary) +
            (s.permission !== "advice" && !referenced.length
              ? "\n\n工作台记录：未提供可关联的成功验证步骤，请按未验证结果审阅。"
              : "");
          s.steps.push({
            id: randomUUID(),
            createdAt: now(),
            summary: "助手回复",
            output: s.summary,
            status: "succeeded",
          });
          this.save(s);
          return;
        }
        if (reply.type === "question") {
          s.status = "awaiting_input";
          s.summary = this.clean(reply.summary);
          s.steps.push({
            id: randomUUID(),
            createdAt: now(),
            summary: "助手提问",
            output: s.summary,
            status: "succeeded",
          });
          this.save(s);
          return;
        }
        const call = reply.call;
        const step: AgentStep = {
          id: randomUUID(),
          createdAt: now(),
          summary: this.clean(reply.summary),
          call: this.cleanValue(call) as AgentToolCall,
          status: "pending",
        };
        s.steps.push(step);
        this.save(s);
        if (JSON.stringify(step.call) !== JSON.stringify(call)) {
          step.status = "rejected";
          step.output =
            "工具参数包含需脱敏的内容，已阻止执行。请使用环境变量或不含密钥的文件/命令，不要将密码和密钥写进操作参数。";
          this.save(s);
          continue;
        }
        if (call.tool === "update_plan") {
          const plan = planSchema.parse(call.arguments);
          const changed = s.steps
            .slice(s.turnStart ?? 0)
            .some(
              (item) =>
                item.call &&
                isMutation(item.call) &&
                !["pending", "rejected"].includes(item.status),
            );
          // Once work starts, acceptance cannot be weakened or replaced to force completion.
          if (
            changed &&
            JSON.stringify(plan.checks) !== JSON.stringify(s.plan?.checks)
          ) {
            step.status = "rejected";
            step.output =
              "变更已开始，不能新增、删除或修改checks验收项。更新计划时原样保留checks；需要改变验收范围时停止并新建明确任务。";
            this.save(s);
            continue;
          }
          const invalid = plan.steps.some(
            (item) =>
              (item.status === "completed" && !item.evidence.length) ||
              item.evidence.some(
                (id) =>
                  !s.steps.some(
                    (e) =>
                      e.id === id &&
                      e.status === "succeeded" &&
                      e.call &&
                      e.call.tool !== "update_plan",
                  ),
              ),
          );
          if (invalid) {
            step.status = "rejected";
            step.output =
              "计划已完成条目必须引用真实成功工具步骤，不能使用虚构证据。";
          } else {
            s.plan = plan;
            step.status = "succeeded";
            step.output = "执行计划已保存，不代表主机操作已执行。";
          }
          this.save(s);
          continue;
        }
        if (s.executionVersion && isMutation(call)) {
          const observations = s.steps
            .slice(s.turnStart ?? 0)
            .some(
              (item) =>
                item.status === "succeeded" &&
                item.call &&
                !isMutation(item.call) &&
                item.call.tool !== "update_plan",
            );
          const hasPlan = s.steps
            .slice(s.turnStart ?? 0)
            .some(
              (item) =>
                item.call?.tool === "update_plan" &&
                item.status === "succeeded",
            );
          if (!s.plan || !hasPlan || !observations) {
            step.status = "rejected";
            step.output =
              'run_command 即使只读也属于变更，不能用于首次预检。下一步请先调用 {"tool":"host_resources","arguments":{}} 或 {"tool":"network_listeners","arguments":{}} 获取成功观测，再用 update_plan 保存计划。之后才允许命令/文件变更；无需重新征求授权。';
            this.save(s);
            continue;
          }
        }
        const decision = toolDecision(s.permission, call);
        if (decision === "deny") {
          step.status = "rejected";
          step.output =
            "后端权限拒绝：当前模式禁止此工具，请使用允许的工具或说明限制。";
          this.save(s);
          continue;
        }
        let approved = false;
        if (decision === "confirm") {
          s.status = "awaiting_approval";
          s.summary = "请审阅具体操作后确认或拒绝";
          let approvalTimer: ReturnType<typeof setTimeout> | undefined;
          const answer = new Promise<boolean>((resolve, reject) => {
            run.pending = { stepId: step.id, call, resolve };
            approvalTimer = setTimeout(() => {
              run.pending = undefined;
              reject(
                new Error("操作确认已超过十分钟，未执行；请补充指令后继续。"),
              );
            }, 600000);
          });
          this.save(s);
          try {
            approved = await answer;
          } finally {
            clearTimeout(approvalTimer);
          }
          if (signal.aborted) throw new Error("任务已停止");
          if (run.pauseRequested) {
            step.status = "rejected";
            step.output =
              "用户暂停，本次待审批操作未执行；继续后需重新提出并审批。";
            pauseAtBoundary();
            return;
          }
          s.status = "running";
          if (!approved) {
            step.status = "rejected";
            step.output = "用户拒绝此操作；不得通过其他工具绕过本次拒绝。";
            this.save(s);
            continue;
          }
        }
        if (this.identity(s) !== s.identity)
          throw new Error("目标配置已变化，未执行操作");
        step.status = "running";
        step.startedAt = now();
        s.summary = step.summary;
        this.save(s);
        try {
          const result = await this.tools.execute(
            s.target,
            s.permission,
            call,
            approved,
            signal,
            (taskId) => {
              step.taskId = taskId;
              this.save(s);
            },
          );
          step.output = (
            typeof result === "string"
              ? this.clean(result)
              : JSON.stringify(this.cleanValue(result), null, 2)
          ).slice(-100000);
          step.status =
            result &&
            typeof result === "object" &&
            "code" in result &&
            result.code !== 0
              ? "failed"
              : "succeeded";
          step.finishedAt = now();
          step.uncertain = false;
          this.save(s);
        } catch (error) {
          step.status = "failed";
          step.uncertain = error instanceof UncertainExecution;
          if (!step.uncertain) step.finishedAt = now();
          step.output = this.clean(
            error instanceof Error ? error.message : String(error),
          );
          this.save(s);
          if (error instanceof UncertainExecution || signal.aborted)
            throw error;
          // Definite tool failures become observations so the model can fix them.
          if (
            s.steps.slice(-3).length === 3 &&
            s.steps.slice(-3).every((item) => item.status === "failed")
          )
            throw new Error(
              "连续三个步骤失败，已停止。请检查错误后补充信息再继续。",
            );
        }
        const recent = s.steps
          .filter((item) => item.call && item.call.tool !== "update_plan")
          .slice(-3);
        if (
          recent.length === 3 &&
          recent.every(
            (item) => item.status === "failed" || item.status === "rejected",
          )
        ) {
          s.status = "awaiting_input";
          s.summary =
            "连续三次操作失败或被拒绝，已暂停，保留现场和执行计划；请检查原因后继续。";
          this.save(s);
          return;
        }
      }
      if (pauseAtBoundary()) return;
      s.status = "awaiting_input";
      s.summary = "已达到本轮步骤上限。请检查执行记录，补充指令后可继续。";
      this.save(s);
    } catch (error) {
      s.status =
        error instanceof UncertainExecution
          ? "unknown"
          : signal.aborted
            ? "cancelled"
            : "failed";
      s.summary = this.clean(
        error instanceof Error ? error.message : String(error),
      );
      const last = s.steps.at(-1);
      if (last && ["pending", "running"].includes(last.status)) {
        last.status = "failed";
        last.output = s.summary;
      }
      this.save(s);
    } finally {
      run.pending = undefined;
    }
  }
  async close() {
    this.closing = true;
    for (const run of this.active.values()) {
      run.controller.abort();
      run.pending?.resolve(false);
    }
    await Promise.allSettled([...this.active.values()].map((run) => run.job));
  }
}
