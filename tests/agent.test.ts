import { afterEach, describe, expect, it } from "vitest";
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
  parseAgentReply,
  parseTool,
  toolDecision,
} from "../src/main/features/agent-contract";
import type { AgentPermission, AgentSession } from "../src/shared/agent";

const cleanups: Array<() => Promise<unknown>> = [];
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
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(reply) } }],
          }),
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
    protocol: "openai",
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
    expect(done.steps.map((step) => step.status)).toEqual([
      "failed",
      "succeeded",
      "succeeded",
    ]);
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
