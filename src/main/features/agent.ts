import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
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
  permissionSchema,
  targetSchema,
  toolDecision,
} from "./agent-contract";

interface StoredSession extends AgentSession {
  identity: string;
}
interface ActiveRun {
  controller: AbortController;
  job?: Promise<void>;
  pending?: {
    stepId: string;
    call: AgentToolCall;
    resolve: (approved: boolean) => void;
  };
}
const idSchema = z.object({ id: z.string().min(1).max(100) }).strict();
const busyStatuses = ["running", "awaiting_approval"];
const now = () => new Date().toISOString();

export class AgentService {
  private active = new Map<string, ActiveRun>();
  private tools: AgentTools;
  private closing = false;
  constructor(
    private core: Backend,
    private ai: AIService,
    private emit: (event: AppEvent) => void,
  ) {
    this.tools = new AgentTools(core);
    for (const s of core.store.list<StoredSession>("aiSessions")) {
      if (busyStatuses.includes(s.status)) {
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
    if (method === "ai.session.start") {
      const p = z
        .object({
          providerId: z.string().min(1),
          permission: permissionSchema,
          target: targetSchema,
          instruction: z.string().trim().min(1).max(30000),
          maxSteps: z.number().int().min(1).max(100).default(40),
        })
        .strict()
        .parse(params);
      const target = await this.tools.validateTarget(p.target);
      if (this.closing) throw new Error("软件正在退出，未启动任务");
      // One active AI session globally also prevents competing local command runs.
      if (this.active.size)
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
        instruction: this.clean(p.instruction),
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
        !["awaiting_input", "completed", "failed", "cancelled"].includes(
          s.status,
        ) ||
        this.active.size
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
      if (s.steps.length >= 200)
        throw new Error("会话已达到 200 步上限，请新建任务");
      s.steps.push({
        id: randomUUID(),
        createdAt: now(),
        summary: "用户补充",
        output: this.clean(p.instruction),
        status: "succeeded",
      });
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
      } else if (s.status === "awaiting_input") {
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
        throw new Error("请先在任务中心核实该主机的远端任务");
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
    const run: ActiveRun = { controller: new AbortController() };
    this.active.set(session.id, run);
    run.job = this.loop(session, run).finally(() => {
      this.active.delete(session.id);
      this.emit({ type: "changed" });
    });
  }
  private async loop(s: StoredSession, run: ActiveRun) {
    const signal = run.controller.signal;
    let formatFailures = 0;
    try {
      for (let turn = 0; turn < s.maxSteps && s.steps.length < 200; turn++) {
        if (signal.aborted) throw new Error("任务已停止");
        if (this.identity(s) !== s.identity)
          throw new Error("模型或目标主机配置已变化，请新建任务");
        s.summary = "正在分析下一步";
        this.save(s);
        const context = JSON.stringify({
          instruction: s.instruction,
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
            agentSystemPrompt,
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
        if (!reply || !("type" in reply))
          throw new Error("模型返回了无效的任务步骤");
        if (reply.type === "finish") {
          const referenced = reply.verification.filter((id) =>
            s.steps.some(
              (step) =>
                step.id === id &&
                step.status === "succeeded" &&
                step.call &&
                [
                  "run_command",
                  "http_check",
                  "read_file",
                  "inspect_system",
                ].includes(step.call.tool),
            ),
          );
          s.verification = referenced;
          s.status = "completed";
          s.summary =
            this.clean(reply.summary) +
            (s.permission !== "advice" && !referenced.length
              ? "\n\n工作台记录：未提供可关联的成功验证步骤，请按未验证结果审阅。"
              : "");
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
          this.save(s);
        } catch (error) {
          step.status = "failed";
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
      }
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
