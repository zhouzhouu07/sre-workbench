import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("script submission shows live output and final exit status", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-feedback-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    // Substitute the SSH-backed IPC boundary; exercise the real renderer and event updates.
    await app.evaluate(({ ipcMain }) => {
      const data = {
        hosts: [{ id: "h", name: "Rocky 9.4", username: "root" }],
        scripts: [],
        tasks: [] as any[],
        deployments: [],
        monitoring: [],
        releases: [],
        providers: [],
      };
      (globalThis as any).__feedbackData = data;
      ipcMain.removeHandler("sre:call");
      ipcMain.handle("sre:call", (_event, method, p) => {
        if (method === "snapshot") return { ok: true, value: data };
        if (method === "execution.preview")
          return {
            ok: true,
            value: {
              ...p,
              token: "preview",
              hostName: "Rocky 9.4",
              username: "root",
              digest: "digest",
            },
          };
        if (method === "execution.run") {
          const task = {
            id: "task",
            hostId: "h",
            title: "主机巡检",
            status: "running",
            logs: "开始巡检",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            step: "远程执行中",
          };
          data.tasks = [task];
          return { ok: true, value: task };
        }
        return { ok: false, error: "Unexpected test RPC: " + method };
      });
    });
    await page.getByRole("button", { name: "刷新数据" }).click();
    await page.getByRole("menuitem", { name: "脚本库" }).click();
    await page.getByRole("combobox").click();
    await page.getByText("Rocky 9.4", { exact: true }).click();
    await page.getByRole("button", { name: "预览执行", exact: true }).click();
    await page.getByRole("button", { name: "确认执行此脚本" }).click();
    await expect(page.getByText("开始巡检", { exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const data = (globalThis as any).__feedbackData;
      data.tasks[0] = {
        ...data.tasks[0],
        status: "failed",
        exitCode: 7,
        logs: "磁盘检查失败",
        step: "已取得持久化退出码",
      };
      BrowserWindow.getAllWindows()[0].webContents.send("sre:event", {
        type: "changed",
      });
    });
    await expect(page.getByText("磁盘检查失败", { exact: true })).toBeVisible();
    await expect(page.getByText("退出码：7", { exact: true })).toBeVisible();
    await expect(page.getByText("失败", { exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
