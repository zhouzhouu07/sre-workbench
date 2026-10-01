import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("Benchmark exposes actual experiment configuration without invented scores", async ({}, info) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-benchmark-ui-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("menuitem", { name: "Agent Studio" }).click();
    await page.getByRole("tab", { name: "Benchmark · 实验" }).click();
    await expect(
      page.getByText("暂无实验结果；不会生成演示分数。"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始真实实验" }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: "允许场景 11 实际重启应用（先持久化检查点）",
      }),
    ).not.toBeChecked();
    await page.screenshot({
      path: info.outputPath("benchmark.png"),
      fullPage: true,
    });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
