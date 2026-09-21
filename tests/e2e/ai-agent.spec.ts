import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Store } from "../../src/main/core/store";

test("server conversation can pause, resume and continue in the chat composer", async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-chat-ui-"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    if (requests++ === 0) await gate;
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "finish",
                summary: "服务器检查已完成",
                verification: [],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  store.put("providers", {
    id: "model",
    name: "验收模型",
    kind: "model",
    protocol: "openai",
    model: "test",
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    timeout: 20,
  });
  store.put("hosts", {
    id: "server",
    name: "测试服务器",
    address: "192.0.2.10",
    port: 22,
    username: "root",
    authType: "password",
    credentialId: "",
    fingerprint: "test-only",
    group: "",
    tags: [],
  });
  store.close();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("menuitem", { name: "AI 助手" }).click();
    await page
      .getByRole("textbox", { name: "任务指令" })
      .fill("查看测试服务器环境");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    release();
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await expect(
      page.getByText("服务器检查已完成", { exact: false }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "任务指令" }).fill("继续总结");
    await page.getByRole("button", { name: "发送并继续", exact: true }).click();
    await expect(
      page.locator(".agent-message.user").filter({ hasText: "继续总结" }),
    ).toBeVisible();
    await expect.poll(() => requests).toBe(3);
    await page.screenshot({
      path: testInfo.outputPath("ai-chat.png"),
      fullPage: true,
    });
  } finally {
    release();
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("AI permission controls and exact approval create a real project file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-agent-ui-"));
  const workspace = path.join(dir, "workspace");
  await mkdir(workspace);
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume request */
    }
    const reply =
      requests++ === 0
        ? {
            type: "tool",
            summary: "创建博客首页",
            call: {
              tool: "write_file",
              arguments: { path: "index.html", content: "<h1>My Blog</h1>" },
            },
          }
        : {
            type: "finish",
            summary: "博客首页已创建；尚未启动服务",
            verification: [],
          };
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reply) } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = new Store(
    dir,
    (value) => value,
    (value) => value,
  );
  await store.init();
  store.put("providers", {
    id: "test-model",
    name: "本地验收模型",
    kind: "model",
    protocol: "openai",
    model: "test",
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    timeout: 10,
  });
  store.put("tasks", {
    id: "ai-record",
    hostId: "h",
    source: "ai",
    title: "AI 隐藏记录",
    status: "succeeded",
    logs: "",
    createdAt: "2026-09-20",
    updatedAt: "2026-09-20",
  });
  store.put("tasks", {
    id: "manual-record",
    hostId: "h",
    title: "普通运维任务",
    status: "succeeded",
    logs: "",
    createdAt: "2026-09-20",
    updatedAt: "2026-09-20",
  });
  store.close();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("menuitem", { name: "AI 助手" }).click();
    await expect(
      page.getByRole("heading", { name: "AI 任务助手" }),
    ).toBeVisible();
    await expect(
      page.getByText("只读诊断", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "执行权限" }).click();
    await page.getByText("自主执行", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "授权并发送" }),
    ).toBeDisabled();
    await expect(page.getByRole("combobox", { name: "执行环境" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("combobox", { name: "目标主机" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "任务指令" })).toBeVisible();
    await page.getByRole("tab", { name: "脚本助手（兼容接口）" }).click();
    await expect(page.getByText("诊断请求", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "任务助手", exact: true }).click();
    // Start through real IPC to avoid automating the native directory picker.
    const session = await page.evaluate(
      async (root) =>
        window.sre.call<{ id: string }>("ai.session.start", {
          providerId: "test-model",
          permission: "confirm",
          target: { kind: "local", root },
          instruction: "创建博客首页",
          maxSteps: 5,
        }),
      workspace,
    );
    await page.getByRole("button", { name: /创建博客首页.*确认执行/ }).click();
    await expect(
      page.getByRole("button", { name: "允许本次操作" }),
    ).toBeVisible();
    await expect(
      readFile(path.join(workspace, "index.html")),
    ).rejects.toThrow();
    await page.getByRole("button", { name: "允许本次操作" }).click();
    await expect(
      page.getByText("博客首页已创建；尚未启动服务", { exact: false }),
    ).toBeVisible();
    expect(await readFile(path.join(workspace, "index.html"), "utf8")).toBe(
      "<h1>My Blog</h1>",
    );
    const detail = await page.evaluate(
      (id) => window.sre.call<any>("ai.session.get", { id }),
      session.id,
    );
    expect(detail.status).toBe("completed");
    expect(detail.steps[0].status).toBe("succeeded");
    await page.getByRole("button", { name: "重命名对话" }).click();
    await page.getByRole("textbox", { name: "对话名称" }).fill("我的博客配置");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /确\s*定/ })
      .click();
    await expect(
      page.getByRole("button", { name: /我的博客配置.*确认执行/ }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "任务中心" }).click();
    await expect(
      page.getByRole("button", { name: "普通运维任务" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "AI 隐藏记录" })).toHaveCount(
      0,
    );
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
