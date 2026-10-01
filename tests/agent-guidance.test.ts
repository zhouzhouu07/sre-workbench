import { expect, it } from "vitest";
import { executionGuidance } from "../src/main/features/agent-execution";
import type { AgentStep, AgentToolCall } from "../src/shared/agent";
const check: AgentToolCall = {
  tool: "verify_file",
  arguments: {
    path: "count.txt",
    format: "text",
    minBytes: 1,
    expectText: "1",
  },
};
const step = (
  id: string,
  status: AgentStep["status"],
  call: AgentToolCall,
): AgentStep => ({
  id,
  status,
  call,
  createdAt: "2026-10-01T00:00:00Z",
  summary: id,
});
it("offers successful readonly SRE observations as finish evidence without requiring unrelated file checks", () => {
  const steps = [step("resources", "succeeded", {tool: "host_resources", arguments: {}})];
  expect(executionGuidance(steps).verificationIds).toEqual(["resources"]);
});
it("keeps older real evidence available and only exposes fresh successful locked checks for finish", () => {
  const steps = [
    step("old-verify", "succeeded", check),
    step("change", "succeeded", {
      tool: "run_command",
      arguments: { command: "work" },
    }),
    ...Array.from({ length: 24 }, (_, i) =>
      step(`read-${i}`, "succeeded", {
        tool: "read_file",
        arguments: { path: "count.txt" },
      }),
    ),
  ];
  const pending = executionGuidance(steps, [check], false);
  expect(pending.evidenceIndex.some((e) => e.id === "old-verify")).toBe(true);
  expect(pending.lastMutationStepId).toBe("change");
  expect(pending.checks[0]).toMatchObject({ status: "missing" });
  expect(pending.verificationIds).toEqual([]);
  steps.push(step("fresh", "succeeded", check));
  expect(executionGuidance(steps, [check], false).verificationIds).toEqual([
    "fresh",
  ]);
  steps.push(step("latest-failed", "failed", check));
  expect(executionGuidance(steps, [check], false)).toMatchObject({
    checks: [{ status: "failed", stepId: "latest-failed" }],
    verificationIds: [],
  });
});
it("still requires independent service verification and never includes failed/unknown evidence", () => {
  const steps = [
    step("write", "succeeded", {
      tool: "write_file",
      arguments: { path: "count.txt", content: "1" },
    }),
    step("file", "succeeded", check),
    step("unknown", "running", {
      tool: "run_command",
      arguments: { command: "restart" },
    }),
  ];
  expect(executionGuidance(steps, [check], true).verificationIds).toEqual([]);
  expect(
    executionGuidance(steps, [check], true).evidenceIndex.map((e) => e.id),
  ).not.toContain("unknown");
  steps[2].status = "succeeded";
  steps.push(
    step("file-after", "succeeded", check),
    step("http", "succeeded", {
      tool: "verify_service",
      arguments: { url: "http://127.0.0.1:18080/" },
    }),
  );
  expect(executionGuidance(steps, [check], true).verificationIds).toEqual([
    "file-after",
    "http",
  ]);
});
