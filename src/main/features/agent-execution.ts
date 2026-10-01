import { z } from "zod";
import path from "node:path";
import type { AgentStep, AgentToolCall } from "../../shared/agent";
import { shellQuote as q } from "../core/safety";
import { verificationCheckSchema } from "./agent-verification";
import {isSreTool} from "./agent-sre-tools";
const unit = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/);
const file = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => !/[\x00-\x1f]/.test(v));
export const planSchema = z
  .object({
    goal: z.string().min(1).max(1000),
    steps: z
      .array(
        z
          .object({
            id: z
              .string()
              .min(1)
              .max(40)
              .regex(/^[a-zA-Z0-9_-]+$/),
            title: z.string().min(1).max(200),
            status: z.enum(["pending", "running", "completed", "blocked"]),
            evidence: z.array(z.string().max(100)).max(10).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    acceptance: z.array(z.string().min(1).max(300)).min(1).max(8),
    checks: z.array(verificationCheckSchema).min(1).max(8).optional(),
  })
  .strict()
  .refine((p) => new Set(p.steps.map((s) => s.id)).size === p.steps.length, {
    message: "计划步骤ID不能重复",
  });
export const executionSchemas = {
  update_plan: planSchema,
  service_action: z
    .object({ unit, action: z.enum(["start", "restart", "reload"]) })
    .strict(),
  compose_action: z
    .object({
      path: file,
      project: z
        .string()
        .max(60)
        .regex(/^[a-z0-9][a-z0-9_-]*$/),
      action: z.enum(["up", "restart"]),
    })
    .strict(),
  compose_check: z
    .object({
      path: file,
      project: z
        .string()
        .max(60)
        .regex(/^[a-z0-9][a-z0-9_-]*$/),
    })
    .strict(),
  verify_service: z
    .object({
      unit: unit.optional(),
      url: z.string().url().max(2000).optional(),
      expectText: z.string().min(1).max(500).optional(),
    })
    .strict()
    .refine((v) => !!v.unit || !!v.url, { message: "至少提供服务名或HTTP地址" })
    .refine((v) => !v.expectText || !!v.url, {
      message: "expectText必须配合url",
    }),
};
export const mutationTools = [
  "write_file",
  "make_directory",
  "run_command",
  "service_action",
  "compose_action",
];
export function completionEvidence(
  steps: AgentStep[],
  ids: string[],
  requireService = steps.some(
    (s) =>
      s.call?.tool === "run_command" ||
      s.call?.tool.startsWith("custom.") ||
      s.call?.tool === "service_action" ||
      s.call?.tool === "compose_action",
  ),
  checks?: AgentToolCall[],
): string[] {
  let last = -1;
  steps.forEach((s, i) => {
    if (
      s.call &&
      (mutationTools.includes(s.call.tool) ||
        s.call.tool.startsWith("custom.")) &&
      !["pending", "rejected"].includes(s.status)
    )
      last = i;
  });
  if (checks?.length) {
    const matched: string[] = [];
    for (const check of checks) {
      const latest = steps
        .slice(last + 1)
        .filter(
          (s) =>
            s.call?.tool === check.tool &&
            JSON.stringify(s.call.arguments) ===
              JSON.stringify(check.arguments),
        )
        .at(-1);
      if (!latest || latest.status !== "succeeded" || !ids.includes(latest.id))
        return [];
      matched.push(latest.id);
    }
    if (requireService) {
      const service = completionEvidence(steps, ids, true);
      if (!service.length) return [];
      matched.push(...service);
    }
    return [...new Set(matched)];
  }
  return [...new Set(ids)].filter((id) =>
    steps.some(
      (s, i) =>
        i > last &&
        s.id === id &&
        s.status === "succeeded" &&
        s.call &&
        (requireService
          ? ["verify_service", "http_check"]
          : ["verify_service", "http_check", "read_file", "compose_check"]
        ).includes(s.call.tool),
    ),
  );
}
export function isCompletionObservation(call: AgentToolCall) {
  return isSreTool(call.tool) || ["run_command", "http_check", "read_file", "inspect_system", "verify_service", "compose_check", "verify_file", "verify_package"].includes(call.tool);
}
export function executionGuidance(
  steps: AgentStep[],
  checks: AgentToolCall[] = [],
  requireService = false,
) {
  let last = -1;
  steps.forEach((step, index) => {
    if (
      step.call &&
      (mutationTools.includes(step.call.tool) ||
        step.call.tool.startsWith("custom.")) &&
      !["pending", "rejected"].includes(step.status)
    )
      last = index;
  });
  const evidenceIndex = steps
    .filter(
      (step) =>
        step.call &&
        step.call.tool !== "update_plan" &&
        step.status === "succeeded" &&
        !step.uncertain,
    )
    .map((step) => ({
      id: step.id,
      tool: step.call!.tool,
      summary: step.summary.slice(0, 200),
    }));
  return {
    evidenceIndex,
    lastMutationStepId: steps[last]?.id ?? null,
    serviceVerificationRequired: requireService,
    checks: checks.map((call) => {
      const latest = steps
        .slice(last + 1)
        .filter(
          (step) =>
            step.call?.tool === call.tool &&
            JSON.stringify(step.call.arguments) ===
              JSON.stringify(call.arguments),
        )
        .at(-1);
      return {
        call,
        status: !latest
          ? "missing"
          : latest.status === "succeeded" && !latest.uncertain
            ? "passed"
            : latest.status,
        stepId: latest?.id,
      };
    }),
    verificationIds: last < 0 ? steps.filter(step => step.status === "succeeded" && !step.uncertain && step.call && isCompletionObservation(step.call)).map(step => step.id) : completionEvidence(
      steps,
      evidenceIndex.map((item) => item.id),
      requireService,
      checks,
    ),
  };
}
export function renderAction(call: AgentToolCall, root: string): string {
  const a = call.arguments;
  if (call.tool === "service_action")
    return `set -e\nsystemctl ${a.action} -- ${q(String(a.unit))}\nsystemctl is-active --quiet -- ${q(String(a.unit))}`;
  const file = path.posix.resolve(root, String(a.path)),
    relative = path.posix.relative(root, file);
  if (!relative)
    throw new Error(
      "path必须指向Compose配置文件（如compose.yaml），不能填写工作目录或点号",
    );
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  )
    throw new Error("配置路径超出工作目录");
  const docker = `docker --host unix:///var/run/docker.sock compose --project-directory "$root" --project-name ${q(String(a.project))} --file "$config"`;
  return (
    `set -e\nroot=$(realpath -e -- ${q(root)})\nconfig=$(realpath -e -- ${q(file)})\ncase "$config" in "\${root%/}"/*) ;; *) echo '配置路径超出工作目录' >&2; exit 1;; esac\ntest -f "$config"\ncd -- "$root"\n${docker} config --quiet\n` +
    (call.tool === "compose_check"
      ? ""
      : a.action === "up"
        ? `${docker} up --detach --wait --wait-timeout 90`
        : `${docker} restart`)
  );
}

// Runs after the existing realpath scope guard sets $target. Backups stay beside
// the target; only this invocation's staging file and lock directory are cleaned.
export function renderManagedWrite(content: string): string {
  return `set -e
test -d "$(dirname -- "$target")" || { echo '父目录不存在，请先用make_directory创建，再写入文件' >&2; exit 1; }
lock="$target.sre-write-lock"
mkdir -- "$lock" || { echo '文件存在其他写操作或遗留锁，请先核实' >&2; exit 1; }
stage=''
cleanup() { test -z "$stage" || rm -f -- "$stage"; rmdir -- "$lock"; }
trap cleanup EXIT
before='missing'
if test -e "$target"; then
 test -f "$target" && test ! -L "$target" || { echo '不是普通文件' >&2; exit 1; }
 before=$(sha256sum -- "$target" | cut -d ' ' -f 1)
 backup=$(mktemp -- "$target.sre-backup.XXXXXXXX")
 cp -p -- "$target" "$backup"
 printf 'SRE_BACKUP=%s\\n' "$backup"
fi
stage=$(mktemp -- "$target.sre-stage.XXXXXXXX")
printf %s ${q(Buffer.from(content, "utf8").toString("base64"))} | base64 -d > "$stage"
if test "$before" = missing; then
 test ! -e "$target" && test ! -L "$target" || { echo '目标已被其他操作创建' >&2; exit 1; }
 chmod 644 -- "$stage"
else
 test "$(sha256sum -- "$target" | cut -d ' ' -f 1)" = "$before" || { echo '原文件已变化，未覆盖' >&2; exit 1; }
 chmod --reference="$target" -- "$stage"
 chown --reference="$target" -- "$stage"
 if command -v selinuxenabled >/dev/null 2>&1 && selinuxenabled; then chcon --reference="$target" -- "$stage"; fi
fi
mv -f -- "$stage" "$target"
stage=''
printf 'SRE_WRITTEN=%s\\n' "$target"
sha256sum -- "$target"
`;
}
