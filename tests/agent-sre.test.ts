import { describe, it, expect, vi } from "vitest";
import { parseTool, toolDecision } from "../src/main/features/agent-contract";
import { AgentTools } from "../src/main/features/agent-tools";

describe("SRE read-only diagnostics", () => {
  it("includes process ownership in listener evidence when the SSH account can observe it", async () => {
    const exec = vi
      .fn()
      .mockResolvedValue({
        code: 0,
        stdout: 'LISTEN 0 5 0.0.0.0:18087 users:(("python3",pid=123,fd=3))',
        stderr: "",
      });
    const result: any = await new AgentTools({ ssh: { exec } } as any).execute(
      { kind: "ssh", root: "/", hostId: "host", sudo: false },
      "readonly",
      parseTool({ tool: "network_listeners", arguments: {} }),
      false,
      new AbortController().signal,
      () => {},
    );
    expect(exec.mock.calls[0][1]).toBe("ss -lntup");
    expect(result.stdout).toContain("pid=123");
  });
  it("collects service ownership, startup policy and restart evidence without shell access", async () => {
    const exec = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "UnitFileState=enabled\nRestart=on-failure\nNRestarts=2\n",
      stderr: "",
    });
    const result: any = await new AgentTools({ ssh: { exec } } as any).execute(
      { kind: "ssh", root: "/", hostId: "host", sudo: false },
      "readonly",
      parseTool({
        tool: "service_status",
        arguments: { unit: "blog.service" },
      }),
      false,
      new AbortController().signal,
      () => {},
    );
    for (const property of [
      "UnitFileState",
      "FragmentPath",
      "WorkingDirectory",
      "User",
      "Group",
      "Restart",
      "NRestarts",
      "ExecMainCode",
    ]) {
      expect(exec.mock.calls[0][1]).toContain(property);
    }
    expect(exec.mock.calls[0][1]).not.toContain("Environment");
    expect(exec.mock.calls[0][1]).not.toContain("ExecStart");
    expect(result.stdout).toContain("UnitFileState=enabled");
  });
  it("permits structured diagnostics but never arbitrary commands in readonly mode", () => {
    for (const [tool, args] of [
      ["host_resources", {}],
      ["clock_status", {}],
      ["network_listeners", {}],
      ["service_status", { unit: "nginx.service" }],
      ["service_logs", { unit: "nginx.service", minutes: 30, lines: 50 }],
      ["container_logs", { container: "blog-web", minutes: 15, lines: 50 }],
      ["monitoring_query", { stackId: "mon", kind: "targets" }],
    ] as const) {
      const call = parseTool({ tool, arguments: args });
      expect(toolDecision("readonly", call)).toBe("allow");
      expect(toolDecision("advice", call)).toBe("deny");
    }
    expect(
      toolDecision(
        "readonly",
        parseTool({ tool: "run_command", arguments: { command: "uptime" } }),
      ),
    ).toBe("deny");
  });
  it("rejects injected identifiers, unbounded logs and arbitrary monitoring URLs", () => {
    for (const arguments_ of [
      { unit: "nginx; touch /tmp/x" },
      { unit: "--help" },
      { unit: "nginx", lines: 10001 },
      { unit: "nginx", minutes: -1 },
    ])
      expect(() =>
        parseTool({ tool: "service_logs", arguments: arguments_ }),
      ).toThrow();
    expect(() =>
      parseTool({
        tool: "monitoring_query",
        arguments: { stackId: "mon", kind: "targets", url: "http://external/" },
      }),
    ).toThrow();
  });
  it("returns timestamped evidence using bounded command templates, without task mutations", async () => {
    const exec = vi
      .fn()
      .mockResolvedValue({ code: 0, stdout: "nginx started", stderr: "" });
    const core: any = {
      ssh: { exec },
      store: { get: vi.fn() },
      tasks: { run: vi.fn() },
    };
    const tools = new AgentTools(core);
    const result: any = await tools.execute(
      { kind: "ssh", root: "/", hostId: "host", sudo: false },
      "readonly",
      parseTool({
        tool: "service_logs",
        arguments: { unit: "nginx.service", minutes: 10, lines: 20 },
      }),
      false,
      new AbortController().signal,
      () => {},
    );
    expect(exec.mock.calls[0][1]).toContain("journalctl");
    expect(exec.mock.calls[0][1]).toContain("--lines=20");
    expect(result.evidence.hostId).toBe("host");
    expect(result.evidence.tool).toBe("service_logs");
    expect(Date.parse(result.evidence.observedAt)).not.toBeNaN();
    expect(core.tasks.run).not.toHaveBeenCalled();
  });
  it("rejects monitoring plans belonging to a different host before SSH", async () => {
    const core: any = {
      ssh: { exec: vi.fn() },
      store: {
        get: () => ({ id: "mon", hostId: "other", prometheusPort: 9092 }),
      },
    };
    await expect(
      new AgentTools(core).execute(
        { kind: "ssh", root: "/", hostId: "host", sudo: false },
        "readonly",
        parseTool({
          tool: "monitoring_query",
          arguments: { stackId: "mon", kind: "targets" },
        }),
        false,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/主机/);
    expect(core.ssh.exec).not.toHaveBeenCalled();
  });
});

import { selectSreSkills } from "../src/shared/sre-skills";
describe("SRE skill selection", () => {
  it("loads monitoring runbook for Grafana and respects explicit generic mode", () => {
    expect(
      selectSreSkills("auto", "Grafana 面板没有信息").map((s) => s.id),
    ).toContain("monitoring-diagnosis");
    expect(selectSreSkills("none", "Grafana 面板没有信息")).toEqual([]);
    expect(
      selectSreSkills("linux-inspection", "检查系统").map((s) => s.id),
    ).toEqual(["linux-inspection"]);
  });
  it("does not force a full host inspection for an unrelated deployment request", () => {
    expect(
      selectSreSkills("auto", "创建一个个人博客").map((s) => s.id),
    ).toEqual(["application-deployment"]);
  });
});

describe("SRE monitoring result semantics", () => {
  const target = {
    kind: "ssh" as const,
    root: "/",
    hostId: "host",
    sudo: false,
  };
  async function query(stdout: string, kind = "query") {
    const core: any = {
      ssh: { exec: vi.fn().mockResolvedValue({ code: 0, stdout, stderr: "" }) },
      store: {
        get: () => ({
          id: "mon",
          hostId: "host",
          prometheusPort: 9092,
          grafanaPort: 9091,
        }),
      },
    };
    const result: any = await new AgentTools(core).execute(
      target,
      "readonly",
      parseTool({
        tool: "monitoring_query",
        arguments: { stackId: "mon", kind, query: "up" },
      }),
      false,
      new AbortController().signal,
      () => {},
    );
    return { core, result };
  }
  it("uses configured loopback endpoint and treats API errors as failed evidence", async () => {
    const { core, result } = await query(
      '{"status":"error","error":"bad query"}',
    );
    expect(core.ssh.exec.mock.calls[0][1]).toContain(
      "127.0.0.1:9092/api/v1/query?query=up",
    );
    expect(result.code).toBe(1);
  });
  it("does not mistake malformed API response for successful diagnostics", async () => {
    expect((await query("<html>not prometheus</html>")).result.code).toBe(1);
  });
  it("retains empty query result as evidence rather than fabricating healthy targets", async () => {
    const { result } = await query('{"status":"success","data":{"result":[]}}');
    expect(result.code).toBe(0);
    expect(result.data.data.result).toEqual([]);
  });
  it("marks oversized output and refuses local execution", async () => {
    const core: any = {
      ssh: {
        exec: vi.fn().mockResolvedValue({
          code: 0,
          stdout: "x".repeat(25000),
          stderr: "",
        }),
      },
    };
    const tools = new AgentTools(core),
      call = parseTool({ tool: "host_resources", arguments: {} });
    const r: any = await tools.execute(
      target,
      "readonly",
      call,
      false,
      new AbortController().signal,
      () => {},
    );
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBe(24000);
    await expect(
      tools.execute(
        { kind: "local", root: "/" },
        "readonly",
        call,
        false,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("仅支持 SSH");
  });
});

it("pins container log reads to the selected host Docker socket", async () => {
  const exec = vi
    .fn()
    .mockResolvedValue({ code: 0, stdout: "log", stderr: "" });
  await new AgentTools({ ssh: { exec } } as any).execute(
    { kind: "ssh", root: "/", hostId: "host", sudo: false },
    "readonly",
    parseTool({ tool: "container_logs", arguments: { container: "blog" } }),
    false,
    new AbortController().signal,
    () => {},
  );
  expect(exec.mock.calls[0][1]).toContain(
    "docker --host unix:///var/run/docker.sock logs",
  );
});
