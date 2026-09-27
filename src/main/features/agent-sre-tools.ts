import { z } from "zod";
import type { Backend } from "../core/backend";
import type { MonitoringStack } from "../../shared/types";
import type { AgentTarget, AgentToolCall } from "../../shared/agent";
import { shellQuote as q } from "../core/safety";
const identifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/);
const logOptions = {
  minutes: z.number().int().min(1).max(1440).default(30),
  lines: z.number().int().min(1).max(300).default(100),
};
export const sreToolSchemas = {
  host_resources: z.object({}).strict(),
  clock_status: z.object({}).strict(),
  network_listeners: z.object({}).strict(),
  service_status: z.object({ unit: identifier }).strict(),
  service_logs: z.object({ unit: identifier, ...logOptions }).strict(),
  container_logs: z.object({ container: identifier, ...logOptions }).strict(),
  monitoring_query: z
    .object({
      stackId: z.string().min(1).max(100),
      kind: z.enum(["targets", "query", "range", "grafana_health"]),
      query: z.string().min(1).max(2000).optional(),
      minutes: z.number().int().min(1).max(1440).default(60),
    })
    .strict()
    .refine((v) => !["query", "range"].includes(v.kind) || !!v.query, {
      message: "指标查询必须提供 PromQL",
      path: ["query"],
    }),
};
export function isSreTool(name: string): name is keyof typeof sreToolSchemas {
  return Object.hasOwn(sreToolSchemas, name);
}
export async function executeSreTool(
  core: Backend,
  target: AgentTarget,
  call: AgentToolCall,
  signal: AbortSignal,
) {
  if (target.kind !== "ssh")
    throw new Error("SRE 诊断工具仅支持 SSH Linux 服务器");
  const a = call.arguments;
  const startedAt = new Date().toISOString();
  let command: string;
  let endpoint: string | undefined;
  switch (call.tool) {
    case "host_resources":
      command =
        "set -e\nuname -a\ncat /etc/os-release\nuptime\nfree -m\ndf -PT\ndf -Pi";
      break;
    case "clock_status":
      command =
        "set -e\nprintf 'REMOTE_EPOCH='\ndate +%s\ndate -u +%FT%TZ\ntimedatectl show --property=NTPSynchronized --property=NTP --property=Timezone\nif command -v chronyc >/dev/null 2>&1; then chronyc tracking; else printf 'chronyc unavailable\\n'; fi";
      break;
    case "network_listeners":
      command = "ss -lntup";
      break;
    case "service_status":
      command = `systemctl show --no-pager --property=Id,LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,MainPID,ActiveEnterTimestamp,UnitFileState,FragmentPath,DropInPaths,WorkingDirectory,User,Group,Restart,NRestarts -- ${q(String(a.unit))}`;
      break;
    case "service_logs":
      command = `journalctl --no-pager --output=short-iso --unit=${q(String(a.unit))} --since=${q(`${a.minutes} minutes ago`)} --lines=${a.lines}`;
      break;
    case "container_logs":
      command = `docker --host unix:///var/run/docker.sock logs --timestamps --since=${a.minutes}m --tail=${a.lines} -- ${q(String(a.container))}`;
      break;
    case "monitoring_query": {
      const stack = core.store.get<MonitoringStack>(
        "monitoring",
        String(a.stackId),
      );
      if (!stack || stack.hostId !== target.hostId)
        throw new Error("监控方案不存在或不属于本次目标主机");
      const port =
        a.kind === "grafana_health"
          ? (stack.grafanaPort ?? 3000)
          : (stack.prometheusPort ?? 9090);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("监控端口配置无效");
      const route =
        a.kind === "targets"
          ? "/api/v1/targets"
          : a.kind === "grafana_health"
            ? "/api/health"
            : a.kind === "range"
              ? "/api/v1/query_range"
              : "/api/v1/query";
      const url = new URL(`http://127.0.0.1:${port}${route}`);
      if (a.query && ["query", "range"].includes(String(a.kind)))
        url.searchParams.set("query", String(a.query));
      if (a.kind === "range") {
        const end = Math.floor(Date.now() / 1000);
        url.searchParams.set("end", String(end));
        url.searchParams.set("start", String(end - Number(a.minutes) * 60));
        url.searchParams.set(
          "step",
          String(Math.max(15, Math.ceil((Number(a.minutes) * 60) / 240))),
        );
      }
      endpoint = url.toString();
      command = `curl -q --request GET --proto '=http' --noproxy '*' --silent --show-error --fail --max-time 15 --max-filesize 100000 -- ${q(endpoint)}`;
      break;
    }
    default:
      throw new Error("未知 SRE 工具");
  }
  if (signal.aborted) throw new Error("任务已停止");
  const result = await core.ssh.exec(target.hostId, command, {
    sudo: target.sudo,
    timeout: 20000,
    raw: true,
  });
  if (signal.aborted) throw new Error("任务已停止");
  const observedAt = new Date().toISOString();
  const truncated = result.stdout.length > 24000 || result.stderr.length > 8000;
  let data: unknown;
  let code = result.code;
  if (call.tool === "monitoring_query" && code === 0) {
    try {
      data = JSON.parse(result.stdout);
      const response = data as any;
      if (
        a.kind === "grafana_health"
          ? response?.database !== "ok"
          : response?.status !== "success"
      )
        code = 1;
    } catch {
      code = 1;
    }
  }
  if (call.tool === "clock_status") {
    const epoch = /^REMOTE_EPOCH=(\d+)$/m.exec(result.stdout);
    data = {
      remoteEpoch: epoch ? Number(epoch[1]) : null,
      clientEpoch: Date.parse(observedAt) / 1000,
      clockOffsetSeconds: epoch
        ? Math.round(
            Number(epoch[1]) -
              (Date.parse(startedAt) + Date.parse(observedAt)) / 2000,
          )
        : null,
      measurementWindowSeconds:
        (Date.parse(observedAt) - Date.parse(startedAt)) / 1000,
    };
  }
  return {
    code,
    evidence: {
      tool: call.tool,
      hostId: target.hostId,
      startedAt,
      observedAt,
      endpoint,
    },
    data:
      call.tool === "monitoring_query" && result.stdout.length > 24000
        ? undefined
        : data,
    stdout: result.stdout.slice(0, 24000),
    stderr: result.stderr.slice(0, 8000),
    truncated,
    note: "执行成功只表示取得观测，不代表服务健康；诊断数据可能不完整，需结合输出判断。",
  };
}
