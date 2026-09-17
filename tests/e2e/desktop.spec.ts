import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("empty workbench navigates, validates hosts and preserves saved metadata", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "sre-中文-"));
  const launch = () =>
    electron.launch({
      args: ["."],
      env: { ...process.env, SRE_DATA_DIR: data },
    });
  let app = await launch();
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("运维工作台", { exact: true })).toBeVisible();
    await page.getByRole("menuitem", { name: "主机管理" }).click();
    await page.getByRole("button", { name: "添加主机" }).click();
    await page.getByRole("button", { name: /^保\s*存$/ }).click();
    await expect(page.getByText("请输入主机名称")).toBeVisible();
    await page.getByLabel("主机名称").fill("测试 Linux");
    await page.getByLabel("主机地址").fill("192.0.2.10");
    await page.getByLabel("SSH 用户").fill("ops");
    await page
      .getByLabel("登录密码", { exact: true })
      .fill("test-password-not-a-real-secret");
    await page.getByRole("button", { name: /^保\s*存$/ }).click();
    await expect(page.getByText("测试 Linux", { exact: true })).toBeVisible();
    await page.getByRole("menuitem", { name: "脚本库" }).click();
    await expect(page.getByRole("heading", { name: "脚本库" })).toBeVisible();
    await page.getByRole("menuitem", { name: "AI 助手" }).click();
    await expect(page.getByText("发送前预览")).toBeVisible();
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.getByRole("menuitem", { name: "主机管理" }).click();
    await expect(
      reopened.getByText("测试 Linux", { exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
