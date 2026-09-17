import { describe, expect, it } from "vitest";
import { monitorSchema } from "../src/main/features/schemas";
import { monitoringFiles } from "../src/main/features/monitoring";
import { parse } from "yaml";

const base = {
  hostId: "host",
  name: "监控",
  targets: [{ hostId: "host", address: "10.0.0.2" }],
  retentionDays: 15,
  cpuThreshold: 85,
  memoryThreshold: 90,
  diskThreshold: 90,
  duration: "5m",
  groupWait: "30s",
  groupInterval: "5m",
  repeatInterval: "4h",
  smtpHost: "",
  smtpFrom: "",
  smtpTo: "",
  smtpUser: "",
  webhook: "",
};

describe("monitoring form boundary", () => {
  it.each([
    [465, false],
    [587, true],
  ])(
    "uses the port %i TLS transport without requiring a second STARTTLS upgrade",
    (port, startTls) => {
      const files = monitoringFiles(
        {
          ...base,
          id: "monitor",
          smtpEnabled: true,
          smtpHost: `smtp.example.com:${port}`,
          smtpFrom: "a@example.com",
          smtpTo: "b@example.com",
        },
        "code",
        "grafana",
      );
      expect(
        parse(files["alertmanager.yml"]).receivers[0].email_configs[0]
          .require_tls,
      ).toBe(startTls);
    },
  );
  it("accepts a disabled preset without mailbox fields and enables it once complete", () => {
    const preset = { ...base, smtpEnabled: false, smtpHost: "smtp.qq.com:587" };
    expect(monitorSchema.safeParse(preset).success).toBe(true);
    expect(
      monitorSchema.safeParse({ ...preset, smtpEnabled: true }).success,
    ).toBe(false);
    expect(
      monitorSchema.safeParse({
        ...preset,
        smtpEnabled: true,
        smtpFrom: "sender@qq.com",
        smtpTo: "a@example.com, b@example.com",
        smtpPassword: "authorization-code",
      }).success,
    ).toBe(true);
  });
  it("infers legacy enabled email and rejects malformed recipient lists and ports", () => {
    const legacy = {
      ...base,
      smtpHost: "smtp.example.com:587",
      smtpFrom: "sender@example.com",
      smtpTo: "ops@example.com",
    };
    expect(monitorSchema.parse(legacy).smtpUser).toBe("");
    expect(
      monitorSchema.safeParse({ ...legacy, smtpTo: "ops@example.com,invalid" })
        .success,
    ).toBe(false);
    expect(
      monitorSchema.safeParse({ ...legacy, smtpHost: "smtp.example.com:65536" })
        .success,
    ).toBe(false);
  });
  it("rejects an empty target list before any backend work", () => {
    const result = monitorSchema.safeParse({ ...base, targets: [] });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].path).toEqual(["targets"]);
  });
  it("preserves an explicitly anonymous relay while accepting preset and custom logins", () => {
    const mail = {
      ...base,
      smtpEnabled: true,
      smtpHost: "smtp.qq.com:587",
      smtpFrom: "sender@qq.com",
      smtpTo: "ops@example.com",
    };
    expect(monitorSchema.parse(mail).smtpUser).toBe("");
    expect(
      monitorSchema.parse({ ...mail, smtpUser: "sender@qq.com" }).smtpUser,
    ).toBe("sender@qq.com");
    expect(
      monitorSchema.parse({ ...mail, smtpUser: "custom-login" }).smtpUser,
    ).toBe("custom-login");
  });
  it("reports incomplete enabled email against the corresponding fields", () => {
    const result = monitorSchema.safeParse({ ...base, smtpEnabled: true });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((i) => i.path[0])).toEqual(
        expect.arrayContaining(["smtpHost", "smtpFrom", "smtpTo"]),
      );
  });
  it("preserves inactive SMTP configuration and blank secret semantics", () => {
    const result = monitorSchema.parse({
      ...base,
      smtpEnabled: false,
      smtpHost: "smtp.example.com:2525",
      smtpUser: "existing",
      smtpPassword: "",
      smtpCredentialId: "secret",
    });
    expect(result.smtpHost).toBe("smtp.example.com:2525");
    expect(result.smtpUser).toBe("existing");
    expect(result.smtpPassword).toBe("");
    expect(result.smtpCredentialId).toBe("secret");
  });
  it("rejects unreachable and duplicate targets at their field paths", () => {
    const result = monitorSchema.safeParse({
      ...base,
      targets: [
        { hostId: "host", address: "127.0.0.1" },
        { hostId: "host", address: "10.0.0.2" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((i) => i.path.join("."))).toEqual(
        expect.arrayContaining(["targets.0.address", "targets.1.hostId"]),
      );
  });
});
