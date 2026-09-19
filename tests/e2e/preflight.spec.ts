import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("deployment blocks failed environment checks and permits execution after recheck", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-preflight-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      let checked = 0;
      const data = {
        hosts: [{ id: "h", name: "Rocky" }],
        deployments: [
          {
            id: "d",
            hostId: "h",
            name: "demo",
            template: "node",
            publicPort: 8080,
          },
        ],
        tasks: [],
        scripts: [],
        releases: [],
        monitoring: [],
        providers: [],
      };
      ipcMain.removeHandler("sre:call");
      ipcMain.handle("sre:call", (_e, method) => {
        if (method === "snapshot") return { ok: true, value: data };
        if (method === "deployment.preflight") {
          checked++;
          return {
            ok: true,
            value: {
              ready: checked > 1,
              checks: [
                {
                  id: "port-8080",
                  status: checked > 1 ? "pass" : "fail",
                  detail:
                    checked > 1 ? "TCP 8080 空闲" : "TCP 8080 被其他服务占用",
                },
              ],
            },
          };
        }
        if (method === "deployment.preview")
          return {
            ok: true,
            value: {
              token: "t",
              script: "echo deploy",
              summary: "test deploy",
            },
          };
        if (method === "deployment.run")
          return {
            ok: true,
            value: {
              id: "task",
              hostId: "h",
              title: "部署 demo",
              status: "running",
              logs: "准备部署",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
        return { ok: false, error: "Unexpected RPC " + method };
      });
    });
    await page.getByRole("button", { name: "刷新数据" }).click();
    await page.getByRole("menuitem", { name: "应用部署" }).click();
    await page.getByRole("button", { name: /^部\s*署$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("TCP 8080 被其他服务占用", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "确认执行", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "重新检查环境" }).click();
    await expect(
      dialog.getByText("TCP 8080 空闲", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /确认执行/ }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: /确认执行/ }).click();
    await expect(page.getByText("准备部署", { exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
