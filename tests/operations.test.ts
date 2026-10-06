import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Backend } from "../src/main/core/backend";
import { FeatureService } from "../src/main/features/operations";
import { safeFiles } from "../src/main/features/source";
import { monitoringFiles } from "../src/main/features/monitoring";
import { parse } from "yaml";
import { EventEmitter } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createConnection, Server } from "node:net";

const roots: string[] = [];
const cores: Backend[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
  for (const p of roots.splice(0))
    await rm(p, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sre-ops-"));
  roots.push(dir);
  const core = new Backend({
    dataDir: dir,
    encrypt: (s) => Buffer.from(s).toString("base64"),
    decrypt: (s) => Buffer.from(s, "base64").toString(),
    emit: () => {},
    chooseFile: async () => null,
  });
  await core.init();
  cores.push(core);
  core.store.put("hosts", {
    id: "host",
    name: "test",
    address: "192.0.2.10",
    port: 22,
    username: "root",
    authType: "password",
    credentialId: core.store.setSecret("pw"),
    fingerprint: "SHA256:test",
    group: "",
    tags: [],
  });
  const service = new FeatureService(core, {
    gitPath: "git",
    tempDir: dir,
    openExternal: async () => {},
  });
  return { core, service, dir };
}
const deployment = {
  hostId: "host",
  name: "demo",
  sourceType: "local",
  source: "C:/app",
  gitRef: "main",
  template: "node",
  runtime: "22",
  installCommand: "npm ci",
  buildCommand: "",
  startCommand: "node server.js",
  outputDir: "dist",
  containerPort: 3000,
  publicPort: 8080,
  domain: "",
  healthPath: "/",
  env: { API_KEY: "secret-123" },
  volumes: [],
};
const monitor = {
  hostId: "host",
  name: "monitor",
  targets: [{ hostId: "host", address: "192.0.2.10" }],
  retentionDays: 15,
  cpuThreshold: 90,
  memoryThreshold: 90,
  diskThreshold: 85,
  duration: "5m",
  groupWait: "30s",
  groupInterval: "5m",
  repeatInterval: "4h",
  smtpHost: "smtp.example.com:587",
  smtpFrom: "a@example.com",
  smtpTo: "b@example.com",
  smtpUser: "test",
  smtpPassword: "smtp-secret",
  grafanaPassword: "grafana-secret",
  webhook: "https://example.com/hook",
};
describe("operations safety", () => {
  it.each(["save", "delete"])(
    "does not open a stale monitoring tunnel when %s occurs during listen",
    async (action) => {
      const { core, dir } = await setup();
      const opened = vi.fn(async (_url: string) => {});
      const service = new FeatureService(core, {
        gitPath: "git",
        tempDir: dir,
        openExternal: opened,
      });
      const saved = await service.handle("monitoring.save", monitor);
      core.ssh.exec = async (_host, command) => ({
        code: 0,
        stderr: "",
        stdout: command.includes("docker ps")
          ? `sre-mon-${saved.id}\tprometheus\t127.0.0.1:9090->9090/tcp`
          : "ready",
      });
      const client = new EventEmitter() as any;
      client.forwardOut = (_a: any, _b: any, _c: any, _d: any, callback: any) =>
        callback(new Error("old port unavailable"));
      client.end = vi.fn(() => client.emit("close"));
      core.ssh.connect = async () => client;
      let release: (() => void) | undefined;
      const originalListen = Server.prototype.listen;
      const listenSpy = vi
        .spyOn(Server.prototype, "listen")
        .mockImplementation(function (this: Server, ...args: any[]) {
          const callback = args[args.length - 1];
          args[args.length - 1] = () => {
            release = callback;
          };
          return originalListen.apply(this, args as any);
        });
      try {
        const opening = service
          .handle("monitoring.open", { id: saved.id, service: "prometheus" })
          .then(
            () => null,
            (error) => error,
          );
        await expect.poll(() => typeof release).toBe("function");
        if (action === "delete")
          await service.handle("monitoring.delete", { id: saved.id });
        else
          await service.handle("monitoring.save", {
            ...monitor,
            id: saved.id,
            prometheusPort: 19090,
          });
        release!();
        expect((await opening)?.message).toContain("监控方案已改变");
        expect(opened).not.toHaveBeenCalled();
        expect(client.end).toHaveBeenCalled();
      } finally {
        listenSpy.mockRestore();
        service.close();
      }
    },
  );
  it.each([true, false])(
    "concurrent monitoring opens share the probe before browser access (forwarding fails=%s)",
    async (fails) => {
      const { core, dir } = await setup();
      const opened: string[] = [];
      const service = new FeatureService(core, {
        gitPath: "git",
        tempDir: dir,
        openExternal: async (url) => {
          opened.push(url);
        },
      });
      const saved = await service.handle("monitoring.save", monitor);
      core.ssh.exec = async (_host, command) => ({
        code: 0,
        stderr: "",
        stdout: command.includes("docker ps")
          ? `sre-mon-${saved.id}\tprometheus\t127.0.0.1:9090->9090/tcp`
          : "ready",
      });
      const upstream = createHttpServer((_req, res) => res.end("ready"));
      await new Promise<void>((resolve) =>
        upstream.listen(0, "127.0.0.1", resolve),
      );
      const upstreamPort = (upstream.address() as { port: number }).port;
      const callbacks: any[] = [];
      const client = new EventEmitter() as any;
      client.forwardOut = (_a: any, _b: any, _c: any, _d: any, callback: any) =>
        callbacks.push(callback);
      client.end = vi.fn(() => client.emit("close"));
      core.ssh.connect = vi.fn(async () => client);
      const params = { id: saved.id, service: "prometheus" };
      let settled = 0;
      const track = (promise: Promise<any>) =>
        promise.then(
          (value) => {
            settled++;
            return { value };
          },
          (error) => {
            settled++;
            return { error };
          },
        );
      try {
        const first = track(service.handle("monitoring.open", params));
        await expect.poll(() => callbacks.length).toBe(1);
        const second = track(service.handle("monitoring.open", params));
        // Give a cached URL branch time to return while the first actual forwarding probe is blocked.
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(settled).toBe(0);
        expect(opened).toEqual([]);
        expect(core.ssh.connect).toHaveBeenCalledTimes(1);
        for (const callback of callbacks) {
          if (fails) callback(new Error("administratively prohibited"));
          else {
            const stream = createConnection(upstreamPort, "127.0.0.1", () =>
              callback(null, stream),
            );
          }
        }
        const results = await Promise.all([first, second]);
        if (fails) {
          for (const result of results)
            expect((result as any).error.message).toContain("SSH 隧道建立失败");
          expect(opened).toEqual([]);
          expect(client.end).toHaveBeenCalled();
        } else {
          expect((results[0] as any).value).toMatch(/^http:\/\/127\.0\.0\.1:/);
          expect((results[1] as any).value).toBe((results[0] as any).value);
          expect(opened).toEqual([(results[0] as any).value]);
        }
      } finally {
        service.close();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      }
    },
  );
  it("rejects SSH forwarding failures before opening a browser and releases the tunnel", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", monitor);
    core.ssh.exec = async (_host, command) => ({
      code: 0,
      stderr: "",
      stdout: command.includes("docker ps")
        ? `sre-mon-${saved.id}\tprometheus\t127.0.0.1:9090->9090/tcp`
        : "ready",
    });
    const client = new EventEmitter() as any;
    let ended = false;
    client.forwardOut = (_a: any, _b: any, _c: any, _d: any, cb: any) =>
      cb(new Error("administratively prohibited"));
    client.end = () => {
      ended = true;
      client.emit("close");
    };
    core.ssh.connect = async () => client;
    await expect(
      service.handle("monitoring.open", {
        id: saved.id,
        service: "prometheus",
      }),
    ).rejects.toThrow("SSH 隧道建立失败");
    expect(ended).toBe(true);
    service.close();
  });
  it("opens a healthy custom port through the correct host, reuses and closes the tunnel", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", {
      ...monitor,
      prometheusPort: 19090,
    });
    const server = createHttpServer((_req, res) => res.end("ready"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const forwarded: number[] = [];
    const hosts: string[] = [];
    core.ssh.exec = async (host, command) => {
      hosts.push(host);
      return {
        code: 0,
        stderr: "",
        stdout: command.includes("docker ps")
          ? `sre-mon-${saved.id}\tprometheus\t127.0.0.1:19090->9090/tcp`
          : "ready",
      };
    };
    const client = new EventEmitter() as any;
    client.forwardOut = (
      _src: any,
      _port: any,
      remote: string,
      port: number,
      cb: any,
    ) => {
      expect(remote).toBe("127.0.0.1");
      forwarded.push(port);
      const socket = createConnection(address.port, "127.0.0.1", () =>
        cb(null, socket),
      );
    };
    client.end = () => client.emit("close");
    core.ssh.connect = async (host) => {
      hosts.push(host);
      return client;
    };
    try {
      const url = await service.handle("monitoring.open", {
        id: saved.id,
        service: "prometheus",
      });
      expect(await (await fetch(url)).text()).toBe("ready");
      expect(
        await service.handle("monitoring.open", {
          id: saved.id,
          service: "prometheus",
        }),
      ).toBe(url);
      expect(hosts.every((h) => h === "host")).toBe(true);
      expect(forwarded.every((p) => p === 19090)).toBe(true);
      service.close();
      await expect(fetch(url)).rejects.toThrow();
    } finally {
      service.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("keeps blank SMTP credentials, replaces explicit updates and never exports them", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", monitor);
    const { smtpPassword, grafanaPassword, ...values } = monitor;
    const kept = await service.handle("monitoring.save", {
      ...values,
      id: saved.id,
      smtpPassword: "",
    });
    expect(core.store.getSecret(kept.smtpCredentialId)).toBe(smtpPassword);
    const changed = await service.handle("monitoring.save", {
      ...values,
      id: saved.id,
      smtpPassword: "replacement-secret",
    });
    expect(changed.smtpCredentialId).toBe(saved.smtpCredentialId);
    expect(core.store.getSecret(changed.smtpCredentialId)).toBe(
      "replacement-secret",
    );
    expect(JSON.stringify(core.store.snapshot())).not.toContain(
      "replacement-secret",
    );
    expect(core.store.redact("SMTP password=replacement-secret")).not.toContain(
      "replacement-secret",
    );
  });
  it("reports a submitted test alert suppressed by a silence without claiming delivery", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", monitor);
    core.ssh.exec = async (_host, command) => ({
      code: 0,
      stderr: "",
      stdout: command.includes("docker ps")
        ? `sre-mon-${saved.id}\talertmanager\t127.0.0.1:9093->9093/tcp`
        : command.includes("-X POST")
          ? ""
          : JSON.stringify([
              {
                labels: { alertname: "SREWorkbenchTest" },
                receivers: [{ name: "notifications" }],
                status: {
                  state: "suppressed",
                  silencedBy: ["silence-id"],
                  inhibitedBy: [],
                },
              },
            ]),
    });
    const result = await service.handle("monitoring.test", { id: saved.id });
    expect(result.submitted).toBe(true);
    expect(result.state).toBe("suppressed");
    expect(result.silencedBy).toEqual(["silence-id"]);
    expect(result.message).toContain("静默");
    expect(result.message).not.toContain("已送达");
  });
  it("blocks opening an owned but unhealthy Grafana before creating an SSH tunnel", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", monitor);
    core.ssh.exec = async (_host, command) => ({
      code: 0,
      stderr: "",
      stdout: command.includes("docker ps")
        ? `sre-mon-${saved.id}\tgrafana\t127.0.0.1:3000->3000/tcp`
        : JSON.stringify({ database: "failed" }),
    });
    core.ssh.connect = async () => {
      throw new Error("Must not create tunnel");
    };
    await expect(
      service.handle("monitoring.open", { id: saved.id, service: "grafana" }),
    ).rejects.toThrow("Grafana 健康检查失败");
  });
  it("routes monitor APIs to custom ports and checks ownership before requests", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", {
      ...monitor,
      grafanaPort: 13000,
      prometheusPort: 19090,
      alertmanagerPort: 19093,
    });
    const requests: string[] = [];
    core.ssh.exec = async (_host, command) => {
      requests.push(command);
      return {
        code: 0,
        stderr: "",
        stdout: command.includes("docker ps")
          ? `sre-mon-${saved.id}\tprometheus\t127.0.0.1:19090->9090/tcp\nsre-mon-${saved.id}\talertmanager\t127.0.0.1:19093->9093/tcp`
          : "{}",
      };
    };
    await service.handle("monitoring.status", { id: saved.id });
    await service.handle("monitoring.test", { id: saved.id });
    await service.handle("monitoring.silence", {
      id: saved.id,
      alertname: "Example",
      minutes: 5,
      comment: "test",
    });
    expect(
      requests
        .filter((c) => c.includes("curl"))
        .every((c) => /127\.0\.0\.1:1909[03]/.test(c)),
    ).toBe(true);
    expect(requests.filter((c) => c.includes("curl"))).toHaveLength(6);
    expect(
      requests.some((c) =>
        c.includes("/api/v2/alerts?filter=alertname%3DSREWorkbenchTest"),
      ),
    ).toBe(true);
    core.ssh.exec = async () => ({ code: 0, stderr: "", stdout: "" });
    await expect(
      service.handle("monitoring.test", { id: saved.id }),
    ).rejects.toThrow("不属于当前方案");
  });
  it("blocks foreign Docker port ranges before exporter tasks are created", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", monitor);
    core.ssh.exec = async () => ({
      code: 0,
      stderr: "",
      stdout: "sre-mon-other\told-grafana\t127.0.0.1:2999-3001->2999-3001/tcp",
    });
    const preview = await service.handle("monitoring.preview", {
      id: saved.id,
    });
    await expect(
      service.handle("monitoring.run", { id: saved.id, token: preview.token }),
    ).rejects.toThrow("另一工作台监控方案");
    expect(core.store.list("tasks")).toHaveLength(0);
  });
  it("allows distinct monitoring ports and blocks opening another instance", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", monitor);
    const other = await service.handle("monitoring.save", {
      ...monitor,
      name: "second",
      grafanaUsername: "operator",
      grafanaPort: 13000,
      prometheusPort: 19090,
      alertmanagerPort: 19093,
    });
    expect(other.grafanaUsername).toBe("operator");
    core.ssh.exec = async () => ({
      code: 0,
      stdout: `sre-mon-${saved.id}\tgrafana\t127.0.0.1:13000->3000/tcp\n`,
      stderr: "",
    });
    await expect(
      service.handle("monitoring.open", { id: other.id, service: "grafana" }),
    ).rejects.toThrow("不属于当前方案");
  });
  it("rejects duplicate monitoring ports and emits custom initial username", async () => {
    const { service } = await setup();
    await expect(
      service.handle("monitoring.save", { ...monitor, grafanaPort: 9090 }),
    ).rejects.toThrow("不能重复");
    const saved = await service.handle("monitoring.save", {
      ...monitor,
      grafanaUsername: "operator",
      grafanaPort: 13000,
    });
    const compose = parse(monitoringFiles(saved, "", "secret")["compose.yml"]);
    expect(compose.services.grafana.ports).toEqual(["127.0.0.1:13000:3000"]);
    expect(compose.services.grafana.environment.GF_SECURITY_ADMIN_USER).toBe(
      "operator",
    );
  });
  it("encrypts deployment environment and preserves redacted edits", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("deployment.save", deployment);
    expect(saved.env.API_KEY).toBe("[REDACTED]");
    expect(JSON.stringify(core.store.snapshot())).not.toContain("secret-123");
    expect(core.store.redact("secret-123")).toBe("[REDACTED]");
    const again = await service.handle("deployment.save", {
      ...saved,
      name: "changed",
    });
    expect(again.env.API_KEY).toBe("[REDACTED]");
  });
  it("invalidates preview when saved configuration changes without doing SSH work", async () => {
    const { service } = await setup();
    const saved = await service.handle("deployment.save", deployment);
    const preview = await service.handle("deployment.preview", {
      id: saved.id,
    });
    expect(preview.script).not.toContain("secret-123");
    await service.handle("deployment.save", { ...saved, publicPort: 8081 });
    await expect(
      service.handle("deployment.run", { id: saved.id, token: preview.token }),
    ).rejects.toThrow(/改变|预览/);
  });
  it("invalidates preview when target SSH identity changes", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("deployment.save", deployment);
    const preview = await service.handle("deployment.preview", {
      id: saved.id,
    });
    core.store.put("hosts", {
      ...core.ssh.host("host"),
      address: "192.0.2.20",
    });
    await expect(
      service.handle("deployment.run", { id: saved.id, token: preview.token }),
    ).rejects.toThrow(/改变|预览/);
  });
  it("excludes secrets and dependency trees from local uploads", async () => {
    const { dir } = await setup();
    await mkdir(join(dir, "project", "node_modules"), { recursive: true });
    await mkdir(join(dir, "project", ".git"));
    await writeFile(join(dir, "project", "server.js"), "console.log(1)");
    await writeFile(join(dir, "project", ".env.production"), "API_KEY=secret");
    await writeFile(join(dir, "project", "private.pem"), "private");
    await writeFile(join(dir, "project", "node_modules", "x"), "dependency");
    await writeFile(join(dir, "project", ".git", "config"), "token");
    const files = await safeFiles(join(dir, "project"));
    expect(files.map((f) => f.relative)).toEqual(["server.js"]);
  });
  it("rejects unsafe Git URL credentials and traversal outputs", async () => {
    const { service } = await setup();
    await expect(
      service.handle("deployment.save", {
        ...deployment,
        sourceType: "git",
        source: "https://user:token@example.com/repo.git",
      }),
    ).rejects.toThrow();
    await expect(
      service.handle("deployment.save", {
        ...deployment,
        outputDir: "../../etc",
      }),
    ).rejects.toThrow();
  });
  it("encrypts monitor passwords and webhook and generates connected configs", async () => {
    const { core, service } = await setup();
    const saved = await service.handle("monitoring.save", monitor);
    expect(JSON.stringify(core.store.snapshot())).not.toContain("smtp-secret");
    expect(JSON.stringify(core.store.snapshot())).not.toContain(
      "https://example.com/hook",
    );
    const files = monitoringFiles(
      { ...saved, webhook: monitor.webhook },
      "smtp-secret",
      "grafana-secret",
    );
    const prom = parse(files["prometheus.yml"]);
    expect(prom.scrape_configs[1].static_configs[0].targets).toEqual([
      "192.0.2.10:9100",
    ]);
    const alerts = parse(files["alertmanager.yml"]);
    expect(alerts.receivers[0].webhook_configs[0].url).toBe(
      "https://example.com/hook",
    );
    expect(alerts.receivers[0].email_configs[0].auth_password_file).toBe(
      "/etc/alertmanager/secrets/smtp_password",
    );
    const preview = await service.handle("monitoring.preview", {
      id: saved.id,
    });
    expect(JSON.stringify(preview)).not.toContain("smtp-secret");
  });
  it("rejects missing target identity, command injection and invalid silence", async () => {
    const { service } = await setup();
    await expect(
      service.handle("monitoring.save", {
        ...monitor,
        targets: [{ hostId: "missing", address: "192.0.2.1" }],
      }),
    ).rejects.toThrow();
    await expect(
      service.handle("monitoring.save", {
        ...monitor,
        duration: "5m; touch /tmp/x",
      }),
    ).rejects.toThrow();
    const saved = await service.handle("monitoring.save", monitor);
    await expect(
      service.handle("monitoring.silence", {
        id: saved.id,
        alertname: "NodeDown",
        minutes: 0,
        comment: "",
      }),
    ).rejects.toThrow();
  });
});

it("returns failed read-only preflight reports and enforces a fresh check in task preparation", async () => {
  const { core, service } = await setup();
  const saved = await service.handle("deployment.save", deployment);
  core.ssh.exec = async (_host, command) => ({
    code: 1,
    stdout: "",
    stderr: "sudo: permission denied",
  });
  const report = await service.handle("deployment.preflight", { id: saved.id });
  expect(report.ready).toBe(false);
  expect(
    report.checks.some(
      (c: any) => c.status === "fail" && c.detail.includes("permission denied"),
    ),
  ).toBe(true);
  const preview = await service.handle("deployment.preview", { id: saved.id });
  let preparation: Promise<void> | undefined;
  core.tasks.run = ((_token: any, _spec: any, options: any) => {
    preparation = options.prepare({ id: "fake" });
    return { id: "fake" };
  }) as any;
  await service.handle("deployment.run", {
    id: saved.id,
    token: preview.token,
  });
  await expect(preparation).rejects.toThrow(/预检/);
});

it("keeps numeric monitor metadata intact when a short secret matches digits", async () => {
  const { core, service } = await setup();
  core.store.setSecret("1");
  const saved = await service.handle("monitoring.save", monitor);
  core.ssh.exec = async (_host, command) => ({
    code: 0,
    stderr: "",
    stdout: command.includes("docker ps")
      ? `sre-mon-${saved.id}\tprometheus\t127.0.0.1:9090->9090/tcp\nsre-mon-${saved.id}\talertmanager\t127.0.0.1:9093->9093/tcp\n`
      : JSON.stringify({
          status: "success",
          data: { count: 123, message: "value 1" },
        }),
  });
  const result = await service.handle("monitoring.status", { id: saved.id });
  expect(result.targets.data.count).toBe(123);
  expect(result.targets.data.message).not.toContain("1");
});

it("preserves preflight identifiers and readiness while redacting detail strings", async () => {
  const { core, service } = await setup();
  core.store.setSecret("1");
  const saved = await service.handle("deployment.save", {
    ...deployment,
    publicPort: 8181,
  });
  const ids = [
    "privilege",
    "platform",
    "systemd",
    "tools",
    "disk-/var",
    "disk-/opt",
    "disk-/tmp",
    "memory",
    "runtime-conflicts",
    "docker",
    "dns",
    "selinux",
    "port-8181",
  ];
  core.ssh.exec = async () => ({
    code: 0,
    stderr: "",
    stdout:
      ids.map((id) => `SRE_CHECK\t${id}\tpass\tvalue 1`).join("\n") +
      "\nSRE_PREFLIGHT_DONE\n",
  });
  const report = await service.handle("deployment.preflight", { id: saved.id });
  expect(report.ready).toBe(true);
  expect(
    report.checks.find((check: any) => check.id === "port-8181")?.detail,
  ).toBe("value [REDACTED]");
});
