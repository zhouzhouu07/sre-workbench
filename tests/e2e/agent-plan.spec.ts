import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../src/main/core/store";
test("agent displays persisted execution plan and acceptance criteria", async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-plan-ui-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  store.put("aiSessions", {
    id: "plan-test",
    title: "博客部署计划",
    providerId: "model",
    permission: "autonomous",
    target: { kind: "ssh", hostId: "test", root: "/opt/blog", sudo: false },
    instruction: "部署博客",
    status: "paused",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [],
    summary: "暂停",
    maxSteps: 40,
    verification: [],
    plan: {
      goal: "部署并验证博客",
      steps: [
        {
          id: "inspect",
          title: "检查端口与依赖",
          status: "completed",
          evidence: ["test"],
        },
        {
          id: "deploy",
          title: "创建并启动应用",
          status: "pending",
          evidence: [],
        },
      ],
      acceptance: ["页面返回博客标题"],
      checks: [
        {
          tool: "verify_file",
          arguments: {
            path: "report.json",
            format: "json",
            expectText: "ready",
          },
        },
        { tool: "verify_package", arguments: { name: "python3" } },
      ],
    },
  });
  store.close();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("menuitem", { name: "AI 助手" }).click();
    await page.getByRole("button", { name: /博客部署计划/ }).click();
    await page.getByText("执行计划 · 1/2", { exact: true }).click();
    await expect(
      page.getByText("检查端口与依赖", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("验收：页面返回博客标题", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(350); // Allow the collapse opening transition to finish for visual evidence.
    await expect(page.getByText(/文件验收：report.json/)).toBeVisible();
    await expect(
      page.getByText("安装包验收：python3；已安装", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("execution-plan.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown session restores persisted results and exposes continue", async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-recovery-ui-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  const host = {
    id: "recovery-host",
    name: "Recovery VM",
    address: "192.0.2.10",
    port: 22,
    username: "root",
    authType: "password",
    credentialId: "missing",
    fingerprint: "test",
    group: "",
    tags: [],
  };
  const provider = {
    id: "recovery-model",
    name: "Recovery model",
    kind: "model",
    protocol: "openai",
    baseUrl: "https://example.invalid",
    model: "test",
    credentialId: "missing",
  };
  store.put("hosts", host);
  store.put("providers", provider);
  const { createHash } = await import("node:crypto");
  store.put("tasks", {
    id: "recovery-task",
    hostId: host.id,
    source: "ai",
    title: "长任务",
    status: "succeeded",
    exitCode: 0,
    logs: "checkpoint: finished once",
    lastCheckedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.put("aiSessions", {
    id: "recovery-session",
    title: "断线恢复验收",
    providerId: provider.id,
    identity: createHash("sha256")
      .update(JSON.stringify({ provider, host }))
      .digest("hex"),
    permission: "autonomous",
    target: { kind: "ssh", hostId: host.id, root: "/", sudo: false },
    instruction: "执行长任务",
    status: "unknown",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    maxSteps: 40,
    verification: [],
    summary: "连接中断，待核实",
    steps: [
      {
        id: "recovery-step",
        createdAt: new Date().toISOString(),
        summary: "长任务检查点",
        status: "running",
        uncertain: true,
        taskId: "recovery-task",
        call: {
          tool: "run_command",
          arguments: { command: "echo once", timeout: 60 },
        },
      },
    ],
  });
  store.close();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("menuitem", { name: "AI 助手" }).click();
    await page.getByRole("button", { name: /断线恢复验收/ }).click();
    await page.getByRole("button", { name: "核实并恢复会话" }).click();
    await expect(page.getByText(/远端结果已同步，检查点已恢复/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toBeVisible();
    await page.getByText("长任务检查点", { exact: true }).click();
    await expect(page.getByText(/最近核实：/)).toBeVisible();
    await expect(
      page.getByText("checkpoint: finished once", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(350);
    await page
      .getByText("checkpoint: finished once", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("recovery-checkpoint.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
