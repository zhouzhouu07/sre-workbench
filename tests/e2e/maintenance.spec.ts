import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../src/main/core/store";

test("local delete controls persist and monitoring validates empty targets inline", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-maintenance-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  store.put("hosts", {
    id: "h",
    name: "Rocky",
    address: "192.0.2.10",
    port: 22,
    username: "root",
    authType: "password",
    credentialId: "none",
    group: "",
    tags: [],
  });
  store.put("scripts", {
    id: "s",
    name: "巡检版本",
    body: "uptime",
    version: 1,
    createdAt: new Date().toISOString(),
  });
  store.put("tasks", {
    id: "t",
    hostId: "h",
    title: "已完成巡检",
    status: "succeeded",
    logs: "ok",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.put("deployments", {
    id: "11111111-1111-4111-8111-111111111111",
    hostId: "h",
    name: "待删除应用",
    template: "node",
    domain: "",
    publicPort: 8080,
  });
  store.close();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("menuitem", { name: "脚本库" }).click();
    await page.getByRole("button", { name: "删除 巡检版本 v1" }).click();
    await page.getByRole("button", { name: /^确\s*定$/ }).click();
    await expect(page.getByText("保存后显示版本历史")).toBeVisible();
    await page.getByRole("menuitem", { name: "任务中心" }).click();
    await page.getByRole("button", { name: /^删\s*除$/ }).click();
    await page.getByRole("button", { name: /^确\s*定$/ }).click();
    await expect(page.getByText("已完成巡检", { exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "应用部署" }).click();
    await page.getByRole("button", { name: /^删\s*除$/ }).click();
    await page.getByRole("button", { name: /^确\s*定$/ }).click();
    await expect(page.getByText("待删除应用", { exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "监控告警" }).click();
    await page.getByRole("button", { name: "新建监控方案" }).click();
    await page.getByRole("button", { name: "保存方案" }).click();
    await expect(
      page.getByText("请至少添加一台采集主机", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("监控服务器", { exact: true }).click();
    await page.getByText("Rocky", { exact: true }).click();
    await page.getByRole("button", { name: "添加采集主机" }).click();
    await page.getByRole("combobox").nth(1).click();
    await page.getByText("Rocky", { exact: true }).last().click();
    await page.getByPlaceholder("绑定及采集的内网 IP").fill("192.0.2.10");
    await page
      .getByLabel("Grafana 管理员密码", { exact: true })
      .fill("test-grafana-password");
    await page.getByRole("button", { name: "保存方案" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "部署 / 更新" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^删\s*除$/ }).click();
    await page.getByRole("button", { name: "删除本地配置" }).click();
    await expect(page.getByRole("button", { name: "部署 / 更新" })).toHaveCount(
      0,
    );
    const snapshot = await page.evaluate(() =>
      window.sre.call<any>("snapshot"),
    );
    expect(snapshot.scripts).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.deployments).toEqual([]);
    expect(snapshot.monitoring).toEqual([]);
    expect(snapshot.hosts).toHaveLength(1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
