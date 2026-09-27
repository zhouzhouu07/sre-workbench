import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Backend } from "../src/main/core/backend";
import { AIService } from "../src/main/features/ai";
import { AgentService } from "../src/main/features/agent";
import {
  AgentTools,
  localScopedPath,
  loopbackUrl,
  runLocalCommand,
  scopedPath,
} from "../src/main/features/agent-tools";
import {
  toolSchemas,
  parseAgentReply,
  parseTool,
  toolDecision,
} from "../src/main/features/agent-contract";
import type { AgentPermission, AgentSession } from "../src/shared/agent";

const cleanups: Array<() => Promise<unknown>> = [];
it.each([false, true])(
  "uses locked typed checks but retains service verification after service actions (%s)",
  async (serviceAction) => {
    const plan = {
      goal: "生成巡检报告",
      steps: [
        { id: "report", title: "生成并验证", status: "pending", evidence: [] },
      ],
      acceptance: ["JSON报告含ready"],
      checks: [
        {
          tool: "verify_file",
          arguments: {
            path: "report.json",
            format: "json",
            expectText: "ready",
          },
        },
      ],
    };
    const f = await fixture((context, turn) => {
      if (turn === 0)
        return {
          type: "tool",
          summary: "观测",
          call: { tool: "host_resources", arguments: {} },
        };
      if (turn === 1)
        return {
          type: "tool",
          summary: "计划",
          call: { tool: "update_plan", arguments: plan },
        };
      if (turn === 2)
        return {
          type: "tool",
          summary: "批处理",
          call: serviceAction
            ? {
                tool: "service_action",
                arguments: { unit: "test.service", action: "start" },
              }
            : {
                tool: "run_command",
                arguments: { command: "generate report" },
              },
        };
      if (turn === 3)
        return {
          type: "tool",
          summary: "降低验收",
          call: {
            tool: "update_plan",
            arguments: {
              ...plan,
              checks: [
                { tool: "verify_file", arguments: { path: "other.txt" } },
              ],
            },
          },
        };
      if (turn === 4)
        return { type: "tool", summary: "验收", call: plan.checks[0] };
      return {
        type: "finish",
        summary: "报告已验证",
        verification: [
          context.steps.find((s: any) => s.call?.tool === "verify_file").id,
        ],
      };
    });
    f.core.store.put("hosts", {
      id: "server",
      name: "test",
      address: "192.0.2.10",
      port: 22,
      username: "root",
      fingerprint: "test",
      credentialId: "",
      authType: "password",
      group: "",
      tags: [],
    });
    const execute = vi
      .spyOn(AgentTools.prototype, "execute")
      .mockResolvedValue({ code: 0, stdout: "ok" });
    try {
      const s = (await f.agent.handle("ai.session.start", {
        providerId: "model",
        permission: "autonomous",
        target: {
          kind: "ssh",
          root: "/opt/report",
          hostId: "server",
          sudo: false,
        },
        instruction:
          "执行批处理生成JSON巡检报告，不需要HTTP服务，不得重启其他服务。",
        maxSteps: 10,
      })) as AgentSession;
      const done = await f.until(s.id, (s) =>
        ["completed", "failed", "awaiting_input"].includes(s.status),
      );
      expect(done.status).toBe(serviceAction ? "awaiting_input" : "completed");
      expect(done.steps.find((s) => s.summary === "降低验收")?.status).toBe(
        "rejected",
      );
      expect(done.plan?.checks?.[0].arguments.path).toBe("report.json");
      expect(execute.mock.calls.map((c) => c[2].tool)).toEqual([
        "host_resources",
        serviceAction ? "service_action" : "run_command",
        "verify_file",
      ]);
    } finally {
      execute.mockRestore();
    }
  },
);
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "sre-agent-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
const writeCall = (path = "blog.py", content = "print('blog')") => ({
  tool: "write_file",
  arguments: { path, content },
});
async function fixture(
  respond: (
    context: any,
    turn: number,
    request: any,
  ) => unknown | Promise<unknown>,
  protocol: "openai" | "anthropic" = "openai",
) {
  const root = await directory();
  let turn = 0;
  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      const user = JSON.parse(request.messages.at(-1).content);
      const reply = await respond(JSON.parse(user.context), turn++, request);
      if (!res.destroyed)
        res.end(
          JSON.stringify(
            protocol === "anthropic"
              ? reply
              : {
                  choices: [{ message: { content: JSON.stringify(reply) } }],
                },
          ),
        );
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const core = new Backend({
    dataDir: join(root, "data"),
    encrypt: (s) => s,
    decrypt: (s) => s,
    emit: () => {},
    chooseFile: async () => null,
  });
  await core.init();
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  core.store.put("providers", {
    id: "model",
    name: "test",
    kind: "model",
    protocol,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    model: "test",
    timeout: 10,
  });
  const ai = new AIService(core.store, () => {});
  const agent = new AgentService(core, ai, () => {});
  cleanups.push(async () => {
    await agent.close();
    ai.close();
    await core.close();
  });
  const start = (permission: AgentPermission = "autonomous") =>
    agent.handle("ai.session.start", {
      providerId: "model",
      permission,
      target: { kind: "local", root: workspace },
      instruction: "创建一个博客项目并读取文件验证",
      maxSteps: 10,
    }) as Promise<AgentSession>;
  async function until(
    id: string,
    predicate: (session: AgentSession) => boolean,
  ) {
    for (let i = 0; i < 400; i++) {
      const value = (await agent.handle("ai.session.get", {
        id,
      })) as AgentSession;
      if (predicate(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("会话未达到预期状态");
  }
  return { core, ai, agent, workspace, start, until };
}

describe("AI tool permission and path boundaries", () => {
  it("explains concatenated tool replies without executing a batch", () => {
    const reply = {
      type: "tool",
      summary: "检查",
      call: { tool: "inspect_system", arguments: { kind: "overview" } },
    };
    expect(() =>
      parseAgentReply(JSON.stringify(reply) + "\n\n" + JSON.stringify(reply)),
    ).toThrow("每轮只能返回一个 JSON 对象");
  });
  it("reports the invalid tool argument rather than a generic envelope error", () => {
    expect(() =>
      parseAgentReply({
        type: "tool",
        summary: "检查",
        call: { tool: "inspect_system", arguments: { kind: "environment" } },
      }),
    ).toThrow("arguments.kind");
  });
  it.each(["write_file", "make_directory", "run_command"])(
    "denies %s in read-only mode",
    (tool) => {
      const args =
        tool === "write_file"
          ? { path: "a", content: "b" }
          : tool === "make_directory"
            ? { path: "a" }
            : { command: "echo ok" };
      const call = parseTool({ tool, arguments: args });
      expect(toolDecision("readonly", call)).toBe("deny");
      expect(toolDecision("confirm", call)).toBe("confirm");
      expect(toolDecision("autonomous", call)).toBe("allow");
    },
  );
  it("rejects model-added targets and privilege escalation", () => {
    expect(() =>
      parseTool({
        tool: "run_command",
        arguments: { command: "echo ok", hostId: "another", sudo: true },
      }),
    ).toThrow();
    expect(() =>
      parseAgentReply({
        type: "tool",
        summary: "run",
        permission: "autonomous",
        call: writeCall(),
      }),
    ).toThrow();
    expect(
      toolDecision(
        "advice",
        parseTool({ tool: "read_file", arguments: { path: "a" } }),
      ),
    ).toBe("deny");
  });
  it("rejects parent traversal and prefix lookalikes", async () => {
    const root = await directory();
    expect(() => scopedPath(root, "../outside")).toThrow();
    expect(() => scopedPath("/opt/blog", "/opt/blog-other/a", true)).toThrow();
    expect(scopedPath("/opt/blog", "templates/index.html", true)).toBe(
      "/opt/blog/templates/index.html",
    );
  });
  it("rejects a directory junction or symlink escaping the chosen root", async () => {
    const parent = await directory(),
      root = join(parent, "root"),
      outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(
      outside,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(localScopedPath(root, "linked/file.txt")).rejects.toThrow(
      /超出/,
    );
  });
  it("restricts HTTP checking to HTTP loopback URLs", () => {
    expect(loopbackUrl("http://127.0.0.1:8080/")).toBe(
      "http://127.0.0.1:8080/",
    );
    for (const value of [
      "https://example.com",
      "http://example.com",
      "http://user:pass@localhost",
      "file:///etc/passwd",
    ])
      expect(() => loopbackUrl(value)).toThrow();
  });
  it("rejects dangling links instead of treating them as absent files", async () => {
    const parent = await directory();
    const root = join(parent, "root");
    await mkdir(root);
    await symlink(
      join(parent, "outside-not-created"),
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(localScopedPath(root, "linked/file.txt")).rejects.toThrow();
  });
});

describe("AI session execution with real local HTTP model and filesystem", () => {
  it("preserves previous assistant replies when continuing a conversation", async () => {
    const f = await fixture((_context, turn) => ({
      type: "finish",
      summary: `回复${turn + 1}`,
      verification: [],
    }));
    const s = await f.start();
    await f.until(s.id, (s) => s.status === "completed");
    await f.agent.handle("ai.session.reply", {
      id: s.id,
      instruction: "再解释一下",
    });
    const done = await f.until(s.id, (s) => s.status === "completed");
    expect(
      done.steps.filter((s) => s.summary === "助手回复").map((s) => s.output),
    ).toEqual([
      expect.stringContaining("回复1"),
      expect.stringContaining("回复2"),
    ]);
  });
  it("does not resume a legacy local session while another local task is uncertain", async () => {
    const f = await fixture(() => ({ type: "question", summary: "等待" }));
    const s = await f.start();
    await f.until(s.id, (s) => s.status === "awaiting_input");
    await f.agent.handle("ai.session.pause", { id: s.id });
    f.core.store.put("aiSessions", {
      ...f.core.store.get<any>("aiSessions", s.id),
      id: "uncertain",
      status: "unknown",
    });
    await expect(
      f.agent.handle("ai.session.resume", { id: s.id }),
    ).rejects.toThrow("待核实");
  });
  it("finishes an in-flight tool before pausing and never replays it on resume", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const f = await fixture((_context, turn) =>
      turn === 0
        ? { type: "tool", summary: "创建", call: writeCall() }
        : { type: "finish", summary: "完成", verification: [] },
    );
    const execute = vi
      .spyOn(AgentTools.prototype, "execute")
      .mockImplementationOnce(async () => {
        await gate;
        await writeFile(join(f.workspace, "blog.py"), "once");
        return { code: 0 };
      });
    try {
      const s = await f.start();
      await f.until(s.id, (s) => s.steps[0]?.status === "running");
      await f.agent.handle("ai.session.pause", { id: s.id });
      release();
      const paused = await f.until(s.id, (s) => s.status === "paused");
      expect(paused.steps[0].status).toBe("succeeded");
      await f.agent.handle("ai.session.resume", { id: s.id });
      await f.until(s.id, (s) => s.status === "completed");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(await readFile(join(f.workspace, "blog.py"), "utf8")).toBe("once");
    } finally {
      release();
      execute.mockRestore();
    }
  });
  it("marks only linked legacy remote tasks as AI records", async () => {
    const f = await fixture(() => ({
      type: "finish",
      summary: "完成",
      verification: [],
    }));
    const s = await f.start();
    await f.until(s.id, (s) => s.status === "completed");
    for (const id of ["linked", "ordinary"])
      f.core.store.put("tasks", {
        id,
        title: "task",
        hostId: "host",
        status: "succeeded",
        logs: "",
        createdAt: "",
        updatedAt: "",
      });
    const saved = f.core.store.get<any>("aiSessions", s.id);
    saved.steps = [
      {
        id: "step",
        createdAt: "",
        status: "succeeded",
        summary: "工具",
        taskId: "linked",
      },
    ];
    f.core.store.put("aiSessions", saved);
    const restarted = new AgentService(f.core, f.ai, () => {});
    expect(f.core.store.get<any>("tasks", "linked").source).toBe("ai");
    expect(f.core.store.get<any>("tasks", "ordinary").source).toBeUndefined();
    await restarted.close();
  });
  it("pauses before the next tool and resumes with history without replay", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(async (_context, turn) => {
      if (turn === 0) {
        await gate;
        return { type: "tool", summary: "创建", call: writeCall() };
      }
      return { type: "finish", summary: "已继续", verification: [] };
    });
    const s = await f.start();
    await f.agent.handle("ai.session.rename", {
      id: s.id,
      title: "服务器环境检查",
    });
    await f.agent.handle("ai.session.pause", { id: s.id });
    release();
    const paused = await f.until(s.id, (s) => s.status === "paused");
    expect(paused.title).toBe("服务器环境检查");
    await expect(readFile(join(f.workspace, "blog.py"))).rejects.toThrow();
    await f.agent.handle("ai.session.resume", { id: s.id });
    const completed = await f.until(s.id, (s) => s.status === "completed");
    expect(completed.title).toBe("服务器环境检查");
  });
  it("pauses pending approval without granting or replaying it", async () => {
    const f = await fixture(() => ({
      type: "tool",
      summary: "创建",
      call: writeCall(),
    }));
    const s = await f.start("confirm");
    const pending = await f.until(
      s.id,
      (s) => s.status === "awaiting_approval",
    );
    await f.agent.handle("ai.session.pause", { id: s.id });
    await f.until(s.id, (s) => s.status === "paused");
    await expect(
      f.agent.handle("ai.session.approve", {
        id: s.id,
        stepId: pending.steps[0].id,
        approved: true,
      }),
    ).rejects.toThrow();
    await expect(readFile(join(f.workspace, "blog.py"))).rejects.toThrow();
  });
  it("uses one native Anthropic step with runtime argument validation", async () => {
    let request: any;
    const f = await fixture((_context, _turn, body) => {
      request = body;
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_step",
            id: "t1",
            input: { type: "finish", summary: "检查完成", verification: [] },
          },
        ],
      };
    }, "anthropic");
    const reply = await f.ai.agentStep(
      "model",
      "native-test",
      "system",
      "{}",
      new AbortController().signal,
    );
    expect(reply).toMatchObject({ type: "finish" });
    expect(request.tool_choice).toMatchObject({
      type: "tool",
      name: "submit_step",
    });
    expect(request.tools[0].input_schema.properties.call.anyOf).toHaveLength(
      Object.keys(toolSchemas).length,
    );
  });
  it("rejects parallel native Anthropic calls without executing either", async () => {
    const f = await fixture(
      () => ({
        content: [1, 2].map((n) => ({
          type: "tool_use",
          name: "submit_step",
          id: String(n),
          input: { type: "tool", summary: "写入", call: writeCall() },
        })),
      }),
      "anthropic",
    );
    await expect(
      f.ai.agentStep(
        "model",
        "parallel-test",
        "system",
        "{}",
        new AbortController().signal,
      ),
    ).rejects.toThrow("一个 submit_step");
    await expect(readFile(join(f.workspace, "blog.py"))).rejects.toThrow();
  });
  it("requests JSON output for OpenAI compatible agent steps", async () => {
    let format: unknown;
    const f = await fixture((_context, _turn, request) => {
      format = request.response_format;
      return { type: "finish", summary: "已检查", verification: [] };
    });
    const session = await f.start();
    await f.until(session.id, (s) => s.status === "completed");
    expect(format).toEqual({ type: "json_object" });
  });
  it("requests a corrected model tool envelope without executing malformed arguments", async () => {
    const f = await fixture((_context, turn) =>
      turn === 0
        ? {
            type: "tool",
            summary: "创建",
            call: { tool: "write_file", path: "bad.txt", content: "invalid" },
          }
        : turn === 1
          ? {
              type: "tool",
              summary: "修正格式",
              call: writeCall("good.txt", "valid"),
            }
          : { type: "finish", summary: "已修正", verification: [] },
    );
    const task = await f.start();
    const done = await f.until(task.id, (s) =>
      ["completed", "failed"].includes(s.status),
    );
    expect(done.status).toBe("completed");
    expect(await readFile(join(f.workspace, "good.txt"), "utf8")).toBe("valid");
    await expect(readFile(join(f.workspace, "bad.txt"))).rejects.toThrow();
  });
  it("does not corrupt model instructions or code when a saved password is one digit", async () => {
    const f = await fixture((context, turn) => {
      expect(context.instruction).not.toContain("[REDACTED]");
      return turn === 0
        ? {
            type: "tool",
            summary: "生成代码",
            call: writeCall("v1.txt", "port=18085; count = 1; host=127.0.0.1"),
          }
        : { type: "finish", summary: "完成", verification: [] };
    });
    f.core.store.setSecret(JSON.stringify({ password: "1" }));
    const task = await f.start();
    const done = await f.until(task.id, (s) => s.status === "completed");
    expect(done.steps[0].status).toBe("succeeded");
    expect(await readFile(join(f.workspace, "v1.txt"), "utf8")).toBe(
      "port=18085; count = 1; host=127.0.0.1",
    );
  });
  it("creates files, observes actual contents, and links verification to a successful step", async () => {
    const f = await fixture((context, turn) =>
      turn === 0
        ? { type: "tool", summary: "创建博客", call: writeCall() }
        : turn === 1
          ? {
              type: "tool",
              summary: "验证源码",
              call: { tool: "read_file", arguments: { path: "blog.py" } },
            }
          : {
              type: "finish",
              summary: "文件已生成并读取验证",
              verification: [context.steps.at(-1).id, "invented"],
            },
    );
    const task = await f.start();
    const done = await f.until(task.id, (s) => s.status === "completed");
    expect(await readFile(join(f.workspace, "blog.py"), "utf8")).toBe(
      "print('blog')",
    );
    expect(done.steps[1].output).toContain("print('blog')");
    expect(done.verification).toEqual([done.steps[1].id]);
  });
  it("never writes in read-only mode even when the model requests it", async () => {
    const f = await fixture((_context, turn) =>
      turn === 0
        ? { type: "tool", summary: "写入", call: writeCall() }
        : { type: "finish", summary: "权限不足", verification: [] },
    );
    const task = await f.start("readonly");
    const done = await f.until(task.id, (s) => s.status === "completed");
    expect(done.steps[0].status).toBe("rejected");
    await expect(readFile(join(f.workspace, "blog.py"))).rejects.toThrow();
    await expect(
      new AgentTools(f.core).execute(
        task.target,
        "readonly",
        parseTool(writeCall()),
        true,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/权限/);
  });
  it("waits for the exact step approval before writing and rejects replay", async () => {
    const f = await fixture((_context, turn) =>
      turn === 0
        ? { type: "tool", summary: "写入", call: writeCall() }
        : { type: "finish", summary: "已写入，尚未运行", verification: [] },
    );
    const task = await f.start("confirm");
    const pending = await f.until(
      task.id,
      (s) => s.status === "awaiting_approval",
    );
    await expect(readFile(join(f.workspace, "blog.py"))).rejects.toThrow();
    await expect(
      f.agent.handle("ai.session.approve", {
        id: task.id,
        stepId: "wrong",
        approved: true,
      }),
    ).rejects.toThrow();
    await f.agent.handle("ai.session.approve", {
      id: task.id,
      stepId: pending.steps[0].id,
      approved: true,
    });
    await f.until(task.id, (s) => s.status === "completed");
    expect(await readFile(join(f.workspace, "blog.py"), "utf8")).toContain(
      "blog",
    );
    await expect(
      f.agent.handle("ai.session.approve", {
        id: task.id,
        stepId: pending.steps[0].id,
        approved: true,
      }),
    ).rejects.toThrow();
  });
  it("preserves user rejection without executing the mutation", async () => {
    const f = await fixture((_context, turn) =>
      turn === 0
        ? { type: "tool", summary: "写入", call: writeCall() }
        : { type: "finish", summary: "已拒绝", verification: [] },
    );
    const task = await f.start("confirm"),
      pending = await f.until(task.id, (s) => s.status === "awaiting_approval");
    await f.agent.handle("ai.session.approve", {
      id: task.id,
      stepId: pending.steps[0].id,
      approved: false,
    });
    const done = await f.until(task.id, (s) => s.status === "completed");
    expect(done.steps[0].status).toBe("rejected");
    await expect(readFile(join(f.workspace, "blog.py"))).rejects.toThrow();
  });
  it("feeds failures back so the model can correct a missing parent directory", async () => {
    const replies = [
      {
        type: "tool",
        summary: "写文件",
        call: writeCall("templates/index.html", "<h1>Blog</h1>"),
      },
      {
        type: "tool",
        summary: "创建目录",
        call: { tool: "make_directory", arguments: { path: "templates" } },
      },
      {
        type: "tool",
        summary: "重新写文件",
        call: writeCall("templates/index.html", "<h1>Blog</h1>"),
      },
      { type: "finish", summary: "完成", verification: [] },
    ];
    const f = await fixture((context, turn) => {
      if (turn === 1) expect(context.steps[0].status).toBe("failed");
      return replies[turn];
    });
    const task = await f.start();
    const done = await f.until(task.id, (s) => s.status === "completed");
    expect(
      done.steps.filter((step) => step.call).map((step) => step.status),
    ).toEqual(["failed", "succeeded", "succeeded"]);
    expect(
      await readFile(join(f.workspace, "templates/index.html"), "utf8"),
    ).toBe("<h1>Blog</h1>");
  });
  it("stops while awaiting approval without creating a file", async () => {
    const f = await fixture(() => ({
      type: "tool",
      summary: "写入",
      call: writeCall(),
    }));
    const task = await f.start("confirm");
    await f.until(task.id, (s) => s.status === "awaiting_approval");
    await f.agent.handle("ai.session.stop", { id: task.id });
    await f.until(task.id, (s) => s.status === "cancelled");
    await expect(readFile(join(f.workspace, "blog.py"))).rejects.toThrow();
  });
  it("marks an interrupted persisted session unknown without replaying it", async () => {
    const f = await fixture(() => ({
      type: "finish",
      summary: "ok",
      verification: [],
    }));
    const task = await f.start();
    await f.until(task.id, (s) => s.status === "completed");
    const stored = f.core.store.get<any>("aiSessions", task.id);
    f.core.store.put("aiSessions", { ...stored, status: "running" });
    const restarted = new AgentService(f.core, f.ai, () => {});
    expect(
      (
        (await restarted.handle("ai.session.get", {
          id: task.id,
        })) as AgentSession
      ).status,
    ).toBe("unknown");
    await expect(
      restarted.handle("ai.session.reply", {
        id: task.id,
        instruction: "继续",
      }),
    ).rejects.toThrow();
    await restarted.close();
  });
  it("keeps credentials out of stored observations and model context", async () => {
    const f = await fixture((context, turn) => {
      if (turn) expect(JSON.stringify(context)).not.toContain("secret-abc-987");
      return turn === 0
        ? {
            type: "tool",
            summary: "读取",
            call: { tool: "read_file", arguments: { path: "notes.txt" } },
          }
        : { type: "finish", summary: "已分析", verification: [] };
    });
    f.core.store.setSecret("secret-abc-987");
    await writeFile(join(f.workspace, "notes.txt"), "token is secret-abc-987");
    const task = await f.start("readonly");
    const done = await f.until(task.id, (s) => s.status === "completed");
    expect(done.steps[0].output).not.toContain("secret-abc-987");
  });
});

describe.skipIf(process.platform !== "win32")("Windows local terminal", () => {
  it("uses the selected working directory and returns a nonzero native exit code", async () => {
    const root = await directory();
    const result = await runLocalCommand(
      "[Console]::WriteLine((Get-Location).Path); cmd /c exit 7",
      root,
      10,
      new AbortController().signal,
    );
    expect(result.stdout.toLowerCase()).toContain(root.toLowerCase());
    expect(result.code).toBe(7);
  });
  it("cancels a running command", async () => {
    const root = await directory(),
      controller = new AbortController();
    const pending = runLocalCommand(
      "Start-Sleep -Seconds 30",
      root,
      40,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow(/停止/);
  });
});

describe("SRE skill session integration", () => {
  it("pins the runbook, isolates monitoring metadata and cites real diagnostic evidence", async () => {
    let prompt = "",
      modelContext: any;
    const f = await fixture((context, turn, request) => {
      prompt = request.messages[0].content;
      modelContext = context;
      if (turn === 0)
        return {
          type: "tool",
          summary: "检查时钟",
          call: { tool: "clock_status", arguments: {} },
        };
      return {
        type: "finish",
        summary: "已读取时钟状态，未修改主机",
        verification: [context.steps[0].id, "fake"],
      };
    });
    f.core.store.put("hosts", {
      id: "server",
      name: "test",
      address: "192.0.2.10",
      port: 22,
      username: "root",
      fingerprint: "test-only",
      authType: "password",
      credentialId: "",
      group: "",
      tags: [],
    });
    f.core.store.put("monitoring", {
      id: "mon",
      hostId: "server",
      name: "test",
      prometheusPort: 9092,
      smtpPassword: "must-not-enter-context",
    });
    f.core.store.put("monitoring", {
      id: "other",
      hostId: "other",
      name: "other",
    });
    const exec = vi.spyOn(f.core.ssh, "exec").mockResolvedValue({
      code: 0,
      stdout: "REMOTE_EPOCH=1789990000\nNTPSynchronized=no",
      stderr: "",
    });
    const created = (await f.agent.handle("ai.session.start", {
      providerId: "model",
      permission: "readonly",
      target: { kind: "ssh", hostId: "server", root: "/", sudo: false },
      instruction: "Grafana 没有数据",
      skillMode: "auto",
      maxSteps: 4,
    })) as AgentSession;
    const done = await f.until(
      created.id,
      (s) => s.status === "completed" || s.status === "failed",
    );
    expect(done.status).toBe("completed");
    expect(done.skills?.[0].id).toBe("monitoring-diagnosis");
    expect(prompt).toContain("先 clock_status");
    expect(modelContext.monitoringPlans).toEqual([
      { id: "mon", name: "test", grafanaPort: 3000, prometheusPort: 9092 },
    ]);
    expect(JSON.stringify(modelContext)).not.toContain(
      "must-not-enter-context",
    );
    expect(modelContext.diagnosticEvidence[0].id).toBe(done.steps[0].id);
    expect(done.verification).toEqual([done.steps[0].id]);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe("Autonomous execution workflow", () => {
  it("plans, executes without per-step approval, rejects premature finish and verifies", async () => {
    const plan = {
      goal: "部署博客",
      steps: [
        { id: "deploy", title: "部署并验证", status: "pending", evidence: [] },
      ],
      acceptance: ["HTTP页面包含博客标题"],
    };
    const f = await fixture((context, turn) => {
      const step = (tool: string) =>
        context.steps.find(
          (s: any) => s.call?.tool === tool && s.status === "succeeded",
        );
      switch (turn) {
        case 0:
          return {
            type: "tool",
            summary: "提前变更",
            call: {
              tool: "run_command",
              arguments: { command: "echo forbidden" },
            },
          };
        case 1:
          return {
            type: "tool",
            summary: "预检环境",
            call: { tool: "host_resources", arguments: {} },
          };
        case 2:
          return {
            type: "tool",
            summary: "保存计划",
            call: { tool: "update_plan", arguments: plan },
          };
        case 3:
          return {
            type: "tool",
            summary: "执行部署",
            call: {
              tool: "run_command",
              arguments: { command: "echo deploy" },
            },
          };
        case 4:
          return {
            type: "finish",
            summary: "提前完成",
            verification: [step("run_command").id],
          };
        case 5:
          expect(context.steps.at(-1).output).toContain(step("run_command").id);
          expect(context.steps.at(-1).output).toContain("即使命令只读");
          expect(context.steps.at(-1).output).toContain("不要重复提交 finish");
          return {
            type: "tool",
            summary: "业务验收",
            call: {
              tool: "verify_service",
              arguments: { url: "http://127.0.0.1:18085", expectText: "博客" },
            },
          };
        case 6:
          return {
            type: "tool",
            summary: "更新进度",
            call: {
              tool: "update_plan",
              arguments: {
                ...plan,
                steps: [
                  {
                    id: "deploy",
                    title: "部署并验证",
                    status: "completed",
                    evidence: [step("verify_service").id],
                  },
                ],
              },
            },
          };
        default:
          return {
            type: "finish",
            summary: "博客已验证",
            verification: [step("verify_service").id],
          };
      }
    });
    f.core.store.put("hosts", {
      id: "server",
      name: "test",
      address: "192.0.2.10",
      port: 22,
      username: "root",
      fingerprint: "test",
      credentialId: "",
      authType: "password",
      group: "",
      tags: [],
    });
    const execute = vi
      .spyOn(AgentTools.prototype, "execute")
      .mockResolvedValue({ code: 0, stdout: "博客" });
    try {
      const session = (await f.agent.handle("ai.session.start", {
        providerId: "model",
        permission: "autonomous",
        target: { kind: "ssh", root: "/", hostId: "server", sudo: false },
        instruction: "部署博客",
        maxSteps: 12,
      })) as AgentSession;
      const done = await f.until(session.id, (s) =>
        ["completed", "failed", "awaiting_input"].includes(s.status),
      );
      expect(done.status).toBe("completed");
      expect(done.steps[0].status).toBe("rejected");
      expect(done.steps.some((s) => s.summary === "验收未通过")).toBe(true);
      expect(done.plan?.steps[0].status).toBe("completed");
      expect(execute.mock.calls.map((c) => c[2].tool)).toEqual([
        "host_resources",
        "run_command",
        "verify_service",
      ]);
      expect(done.verification).toEqual([
        done.steps.find((s) => s.call?.tool === "verify_service")!.id,
      ]);
    } finally {
      execute.mockRestore();
    }
  });
});

it("keeps post-change verification pending across user replies and resets only completed work", async () => {
  let turnNo = 0;
  const f = await fixture((context, turn) => {
    turnNo = turn;
    const mutation = context.steps.find(
      (s: any) => s.call?.tool === "run_command",
    );
    const check = context.steps.find(
      (s: any) => s.call?.tool === "verify_service",
    );
    if (turn === 0)
      return {
        type: "tool",
        summary: "预检",
        call: { tool: "host_resources", arguments: {} },
      };
    if (turn === 1)
      return {
        type: "tool",
        summary: "计划",
        call: {
          tool: "update_plan",
          arguments: {
            goal: "修复服务",
            steps: [
              {
                id: "fix",
                title: "修复并验收",
                status: "pending",
                evidence: [],
              },
            ],
            acceptance: ["服务恢复"],
          },
        },
      };
    if (turn === 2)
      return {
        type: "tool",
        summary: "修复",
        call: { tool: "run_command", arguments: { command: "echo repair" } },
      };
    if (turn === 3) return { type: "question", summary: "请补充验收服务名" };
    if (turn === 4)
      return {
        type: "finish",
        summary: "无验证结束",
        verification: [mutation.id],
      };
    if (turn === 5)
      return {
        type: "tool",
        summary: "验收",
        call: { tool: "verify_service", arguments: { unit: "nginx.service" } },
      };
    if (turn === 6)
      return { type: "finish", summary: "已验证", verification: [check.id] };
    return { type: "finish", summary: "下一项需求已接收", verification: [] };
  });
  f.core.store.put("hosts", {
    id: "server",
    name: "test",
    address: "192.0.2.10",
    port: 22,
    username: "root",
    fingerprint: "test",
    credentialId: "",
    authType: "password",
    group: "",
    tags: [],
  });
  const execute = vi
    .spyOn(AgentTools.prototype, "execute")
    .mockResolvedValue({ code: 0, stdout: "ok" });
  try {
    const session = (await f.agent.handle("ai.session.start", {
      providerId: "model",
      permission: "autonomous",
      target: { kind: "ssh", root: "/", hostId: "server", sudo: false },
      instruction: "修复应用服务",
      maxSteps: 12,
    })) as AgentSession;
    await f.until(session.id, (s) => s.status === "awaiting_input");
    await f.agent.handle("ai.session.reply", {
      id: session.id,
      instruction: "继续，nginx.service",
    });
    const done = await f.until(session.id, (s) => s.status === "completed");
    expect(done.steps.some((s) => s.summary === "验收未通过")).toBe(true);
    expect(turnNo).toBe(6);
    expect(done.turnStart).toBe(0);
    await f.agent.handle("ai.session.reply", {
      id: session.id,
      instruction: "总结说明",
    });
    const next = await f.until(session.id, (s) => s.status === "completed");
    expect(next.activeInstruction).toBe("总结说明");
    expect(next.plan).toBeUndefined();
    expect(next.skills).toEqual([]);
    expect(next.skillHistory?.[0].skills[0].id).toBe("incident-repair");
  } finally {
    execute.mockRestore();
  }
});

it("restores a restarted SSH session from persisted task results without replaying its command", async () => {
  const f = await fixture(() => ({
    type: "finish",
    summary: "ready",
    verification: [],
  }));
  f.core.store.put("hosts", {
    id: "recovery-host",
    name: "test",
    address: "192.0.2.10",
    port: 22,
    username: "root",
    fingerprint: "test",
    credentialId: "",
    authType: "password",
    group: "",
    tags: [],
  });
  const started = (await f.agent.handle("ai.session.start", {
    providerId: "model",
    permission: "readonly",
    target: { kind: "ssh", root: "/", hostId: "recovery-host", sudo: false },
    instruction: "检查",
    maxSteps: 10,
  })) as AgentSession;
  await f.until(started.id, (s) => s.status === "completed");
  const saved = f.core.store.get<any>("aiSessions", started.id);
  f.core.store.put("tasks", {
    id: "persisted-job",
    hostId: "recovery-host",
    source: "ai",
    status: "succeeded",
    exitCode: 0,
    logs: "executed once",
  });
  f.core.store.put("aiSessions", {
    ...saved,
    status: "running",
    steps: [
      {
        id: "step",
        status: "running",
        summary: "执行",
        call: { tool: "run_command", arguments: { command: "do-once" } },
        taskId: "persisted-job",
      },
    ],
  });
  const restarted = new AgentService(f.core, f.ai, () => {}),
    execute = vi.spyOn(AgentTools.prototype, "execute");
  try {
    const restored = (await restarted.handle("ai.session.reconcile", {
      id: started.id,
    })) as AgentSession;
    expect(restored.status).toBe("paused");
    expect(restored.steps[0].status).toBe("succeeded");
    expect(restored.steps[0].output).toContain("executed once");
    expect(execute).not.toHaveBeenCalled();
    f.core.store.put("aiSessions", {
      ...saved,
      status: "unknown",
      steps: [
        {
          id: "lost",
          status: "running",
          call: { tool: "run_command", arguments: { command: "unknown" } },
        },
      ],
    });
    expect(
      (
        (await restarted.handle("ai.session.reconcile", {
          id: started.id,
        })) as AgentSession
      ).status,
    ).toBe("unknown");
  } finally {
    execute.mockRestore();
    await restarted.close();
  }
});

it("waits through bounded remote status retries and never launches the command twice", async () => {
  const f = await fixture(() => ({
    type: "finish",
    summary: "done",
    verification: [],
  }));
  const preview = vi
    .spyOn(f.core.tasks, "preview")
    .mockReturnValue({ token: "preview" } as any);
  const run = vi.spyOn(f.core.tasks, "run").mockImplementation(() => {
    const t = {
      id: "retry-job",
      hostId: "host",
      title: "test",
      status: "unknown",
      logs: "",
      reconcileFailures: 1,
      nextCheckAt: new Date(Date.now() + 2000).toISOString(),
    };
    f.core.store.put("tasks", t);
    setTimeout(
      () =>
        f.core.store.put("tasks", {
          ...t,
          status: "succeeded",
          exitCode: 0,
          logs: "once",
        }),
      20,
    );
    return t as any;
  });
  try {
    const result: any = await new AgentTools(f.core).execute(
      { kind: "ssh", hostId: "host", root: "/", sudo: false },
      "autonomous",
      parseTool({
        tool: "run_command",
        arguments: { command: "echo once", timeout: 60 },
      }),
      false,
      new AbortController().signal,
      () => {},
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("once");
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    run.mockRestore();
    preview.mockRestore();
  }
});
