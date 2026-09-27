import { it, expect } from "vitest";
import { parseTool, toolDecision } from "../src/main/features/agent-contract";
import {
  completionEvidence,
  renderAction,
  planSchema,
} from "../src/main/features/agent-execution";
it("requires every declared file/package check after the latest mutation with exact assertions", () => {
  const checks = [
    {
      tool: "verify_file",
      arguments: { path: "result.json", format: "json", expectText: "ready" },
    },
    { tool: "verify_package", arguments: { name: "python3" } },
  ];
  const plan = planSchema.parse({
    goal: "生成结果",
    steps: [{ id: "job", title: "批处理", status: "pending" }],
    acceptance: ["结果与依赖均验证"],
    checks,
  });
  expect(plan.checks).toHaveLength(2);
  const steps: any[] = [
    { id: "change", status: "succeeded", call: { tool: "run_command" } },
    { id: "file", status: "succeeded", call: parseTool(checks[0]) },
    { id: "pkg", status: "succeeded", call: parseTool(checks[1]) },
  ];
  expect(completionEvidence(steps, ["file"], false, plan.checks)).toEqual([]);
  expect(
    completionEvidence(steps, ["file", "pkg"], false, plan.checks),
  ).toEqual(["file", "pkg"]);
  expect(
    completionEvidence(steps, ["file", "pkg"], false, [
      {
        ...checks[0],
        arguments: { ...checks[0].arguments, expectText: "different" },
      },
    ] as any),
  ).toEqual([]);
  expect(completionEvidence(steps, ["file", "pkg"], true, plan.checks)).toEqual(
    [],
  );
  steps.push({ id: "bad", status: "failed", call: parseTool(checks[0]) });
  expect(
    completionEvidence(steps, ["file", "pkg"], false, plan.checks),
  ).toEqual([]);
});
it("validates typed verifier arguments and keeps them read-only", () => {
  for (const call of [
    { tool: "verify_file", arguments: { path: "result.json", format: "json" } },
    {
      tool: "verify_package",
      arguments: { name: "python3", version: "3.9.18" },
    },
  ])
    expect(toolDecision("readonly", parseTool(call))).toBe("allow");
  for (const call of [
    { tool: "verify_file", arguments: { path: "x", sha256: "not-a-hash" } },
    { tool: "verify_file", arguments: { path: "x", command: "touch /tmp/x" } },
    { tool: "verify_package", arguments: { name: "python3;id" } },
    { tool: "verify_package", arguments: { name: "--help" } },
  ])
    expect(() => parseTool(call)).toThrow();
});
it("keeps structured mutations behind existing permissions", () => {
  for (const call of [
    parseTool({
      tool: "service_action",
      arguments: { unit: "nginx.service", action: "restart" },
    }),
    parseTool({
      tool: "compose_action",
      arguments: { path: "compose.yml", project: "blog", action: "up" },
    }),
  ]) {
    expect(toolDecision("readonly", call)).toBe("deny");
    expect(toolDecision("confirm", call)).toBe("confirm");
    expect(toolDecision("autonomous", call)).toBe("allow");
  }
});
it("does not allow arbitrary options or shell injection in managed actions", () => {
  expect(() =>
    parseTool({
      tool: "service_action",
      arguments: { unit: "nginx;id", action: "restart" },
    }),
  ).toThrow();
  expect(() =>
    parseTool({
      tool: "compose_action",
      arguments: {
        path: "compose.yml",
        project: "blog",
        action: "down",
        volumes: true,
      },
    }),
  ).toThrow();
  const command = renderAction(
    parseTool({
      tool: "compose_action",
      arguments: { path: "compose.yml", project: "blog", action: "up" },
    }),
    "/opt/blog",
  );
  expect(command).toContain("config --quiet");
  expect(command).toContain("unix:///var/run/docker.sock");
  expect(command).not.toContain("--remove-orphans");
});
it("requires successful fresh independent verification after the last mutation", () => {
  const steps: any[] = [
    { id: "old", status: "succeeded", call: { tool: "http_check" } },
    { id: "write", status: "succeeded", call: { tool: "run_command" } },
  ];
  expect(completionEvidence(steps, ["old", "write"])).toEqual([]);
  steps.push({
    id: "check",
    status: "failed",
    call: { tool: "verify_service" },
  });
  expect(completionEvidence(steps, ["check"])).toEqual([]);
  steps.push({
    id: "ok",
    status: "succeeded",
    call: { tool: "verify_service" },
  });
  expect(completionEvidence(steps, ["ok", "fake"])).toEqual(["ok"]);
});

import { vi } from "vitest";
import { AgentTools } from "../src/main/features/agent-tools";
it("rejects missing/deconfigured packages and version mismatches using actual query output", async () => {
  const exec = vi
    .fn()
    .mockResolvedValue({ code: 0, stdout: "config-files\t1.2\n", stderr: "" });
  const tools = new AgentTools({ ssh: { exec } } as any);
  const check = () =>
    tools.execute(
      { kind: "ssh", root: "/", hostId: "host", sudo: false },
      "readonly",
      parseTool({
        tool: "verify_package",
        arguments: { name: "test", version: "1.2" },
      }),
      false,
      new AbortController().signal,
      () => {},
    ) as Promise<any>;
  expect((await check()).code).toBe(1);
  exec.mockResolvedValue({ code: 0, stdout: "installed\t1.3\n", stderr: "" });
  expect((await check()).code).toBe(1);
  exec.mockResolvedValue({ code: 0, stdout: "installed\t1.2\n", stderr: "" });
  expect((await check()).code).toBe(0);
  exec.mockResolvedValue({
    code: 1,
    stdout: "package test is not installed",
    stderr: "",
  });
  expect((await check()).code).toBe(1);
});
it("fails independent HTTP verification on wrong page content or redirects", async () => {
  const exec = vi.fn().mockResolvedValue({
    code: 0,
    stdout: "wrong page\nHTTP_STATUS=200\n",
    stderr: "",
  });
  const tools = new AgentTools({ ssh: { exec } } as any),
    target = { kind: "ssh" as const, root: "/", hostId: "host", sudo: false };
  const call = parseTool({
    tool: "verify_service",
    arguments: { url: "http://127.0.0.1:80", expectText: "my-blog" },
  });
  expect(
    (
      (await tools.execute(
        target,
        "readonly",
        call,
        false,
        new AbortController().signal,
        () => {},
      )) as any
    ).code,
  ).toBe(1);
  exec.mockResolvedValue({
    code: 0,
    stdout: "my-blog\nHTTP_STATUS=302\n",
    stderr: "",
  });
  expect(
    (
      (await tools.execute(
        target,
        "readonly",
        call,
        false,
        new AbortController().signal,
        () => {},
      )) as any
    ).code,
  ).toBe(1);
  exec.mockResolvedValue({
    code: 0,
    stdout: "my-blog\nHTTP_STATUS=200\n",
    stderr: "",
  });
  expect(
    (
      (await tools.execute(
        target,
        "readonly",
        call,
        false,
        new AbortController().signal,
        () => {},
      )) as any
    ).code,
  ).toBe(0);
});

import { renderManagedWrite } from "../src/main/features/agent-execution";
it("backs up existing files and stages writes before replacing the target", () => {
  const script = renderManagedWrite("hello");
  expect(script).toContain("cp -p --");
  expect(script).toContain("sha256sum");
  expect(script).toContain("mktemp");
  expect(script).toContain("mv -f --");
  expect(script).toContain("SRE_BACKUP=");
  expect(script.indexOf("cp -p --")).toBeLessThan(script.indexOf("mv -f --"));
});

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileVerificationScript } from "../src/main/features/agent-verification";
const pythonAvailable =
  spawnSync("python", ["--version"], { windowsHide: true }).status === 0;
it.skipIf(!pythonAvailable)(
  "parses real files without executing Python, rejects bad assertions and scope escapes",
  () => {
    const base = mkdtempSync(path.join(tmpdir(), "sre-verifier-")),
      root = path.join(base, "project");
    mkdirSync(root);
    try {
      writeFileSync(path.join(root, "good.json"), '{"status":"ready"}');
      writeFileSync(path.join(root, "bad.json"), "{bad");
      writeFileSync(path.join(root, "nan.json"), '{"value":NaN}');
      writeFileSync(
        path.join(root, "parse.py"),
        'raise RuntimeError("must not execute")\n',
      );
      writeFileSync(path.join(root, "bad.py"), "def broken(\n");
      writeFileSync(path.join(root, "large"), Buffer.alloc(1048577));
      writeFileSync(path.join(base, "outside"), "outside");
      const run = (args: Record<string, unknown>) =>
        spawnSync(
          "python",
          [
            "-I",
            "-S",
            "-c",
            fileVerificationScript,
            root,
            JSON.stringify(
              parseTool({ tool: "verify_file", arguments: args }).arguments,
            ),
          ],
          { encoding: "utf8", windowsHide: true, timeout: 5000 },
        );
      const good = run({
        path: "good.json",
        format: "json",
        expectText: "ready",
      });
      expect(good.status).toBe(0);
      expect(JSON.parse(good.stdout).passed).toBe(true);
      expect(run({ path: "parse.py", format: "python" }).status).toBe(0);
      for (const args of [
        { path: "good.json", expectText: "absent" },
        { path: "good.json", sha256: "0".repeat(64) },
        { path: "bad.json", format: "json" },
        { path: "nan.json", format: "json" },
        { path: "bad.py", format: "python" },
        { path: "large" },
        { path: "missing" },
        { path: "../outside" },
        { path: "." },
      ])
        expect(run(args).status).toBe(1);
      symlinkSync(
        base,
        path.join(root, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(run({ path: "escape/outside" }).status).toBe(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);
const bash =
  process.platform === "win32"
    ? "C:/Program Files/Git/bin/bash.exe"
    : "/bin/bash";
it.skipIf(!existsSync(bash))(
  "executes staged writes with preserved backup on a real local filesystem",
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sre-managed-write-"));
    try {
      const target = path.join(dir, "config.txt");
      writeFileSync(target, "old");
      const result = execFileSync(bash, ["--noprofile", "--norc"], {
        input:
          `target='${target.replaceAll("\\", "/")}'\n` +
          renderManagedWrite("new\n中文"),
        encoding: "utf8",
        windowsHide: true,
      });
      expect(readFileSync(target, "utf8")).toBe("new\n中文");
      const backup = readdirSync(dir).find((name) =>
        name.startsWith("config.txt.sre-backup."),
      )!;
      expect(readFileSync(path.join(dir, backup), "utf8")).toBe("old");
      expect(result).toContain("SRE_BACKUP=");
      expect(
        readdirSync(dir).some(
          (name) =>
            name.includes("sre-stage") || name.includes("sre-write-lock"),
        ),
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("does not accept file reads as business verification for arbitrary shell changes", () => {
  const steps: any = [
    { id: "change", status: "succeeded", call: { tool: "run_command" } },
    { id: "read", status: "succeeded", call: { tool: "read_file" } },
  ];
  expect(completionEvidence(steps, ["read"])).toEqual([]);
  expect(
    completionEvidence(
      [
        { id: "write", status: "succeeded", call: { tool: "write_file" } },
        { id: "read", status: "succeeded", call: { tool: "read_file" } },
      ] as any,
      ["read"],
    ),
  ).toEqual(["read"]);
});

it.skipIf(!existsSync(bash))(
  "reports a missing write parent accurately without creating a lock",
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sre-write-parent-"));
    try {
      const target = path.join(dir, "missing", "file.txt");
      const r = spawnSync(bash, ["--noprofile", "--norc"], {
        input:
          `target='${target.replaceAll("\\", "/")}'\n` +
          renderManagedWrite("content"),
        encoding: "utf8",
        windowsHide: true,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("父目录不存在");
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("explains Compose directory arguments instead of reporting a scope escape", () => {
  expect(() =>
    renderAction(
      parseTool({
        tool: "compose_check",
        arguments: { path: ".", project: "blog" },
      }),
      "/opt/blog",
    ),
  ).toThrow("配置文件");
});
