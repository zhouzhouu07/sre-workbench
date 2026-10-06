import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../src/main/core/store";

test("monitoring explains sender and recipient, shows custom SMTP and preserves preset editing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-monitor-mail-"));
  const store = new Store(
    dir,
    (s) => s,
    (s) => s,
  );
  await store.init();
  store.put("hosts", {
    id: "h",
    name: "Test host",
    address: "192.0.2.10",
    port: 22,
    username: "root",
    authType: "password",
    credentialId: "none",
    group: "",
    tags: [],
  });
  store.put("monitoring", {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Synthetic mail",
    hostId: "h",
    targets: [{ hostId: "h", address: "192.0.2.10" }],
    retentionDays: 15,
    grafanaUsername: "admin",
    cpuThreshold: 85,
    memoryThreshold: 1,
    diskThreshold: 90,
    duration: "1m",
    groupWait: "30s",
    groupInterval: "5m",
    repeatInterval: "4h",
    smtpEnabled: true,
    smtpHost: "smtp.qq.com:587",
    smtpFrom: "synthetic@qq.com",
    smtpTo: "synthetic@qq.com",
    smtpUser: "synthetic@qq.com",
    webhook: "",
  });
  store.close();
  const app = await electron.launch({
    executablePath: process.env.SRE_TEST_BINARY,
    args: process.env.SRE_TEST_BINARY ? [] : ["."],
    env: { ...process.env, SRE_DATA_DIR: dir },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("menuitem", { name: "监控告警" }).click();
    await page.getByRole("button", { name: /^配\s*置$/ }).click();
    await expect(
      page.getByLabel("SMTP 发送账号", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("告警邮件将发送到该地址，可与发送账号相同", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "QQ / 163 等邮箱请填写客户端授权码，不是网页登录密码；已有授权码留空保留。",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .locator(".ant-select")
      .filter({ hasText: "QQ 邮箱" })
      .last()
      .click();
    await page.getByText("自定义 SMTP", { exact: true }).last().click();
    await expect(
      page.getByLabel("SMTP 主机:端口", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("SMTP 认证用户名", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "465 使用直接 TLS，其他端口使用 STARTTLS；始终验证服务器证书。",
        { exact: true },
      ),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
