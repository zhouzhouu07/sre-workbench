import type { ExecutionTrace } from "./trace";
export const benchmarkModes = ["A", "B", "C"] as const;
export type BenchmarkMode = (typeof benchmarkModes)[number];
export const benchmarkScenarios = [
  { id: 1, name: "Python Web 部署", group: "deployment" },
  { id: 2, name: "systemd 服务部署", group: "deployment" },
  { id: 3, name: "Docker Compose 部署", group: "deployment" },
  { id: 4, name: "ExecStart 路径错误", group: "repair" },
  { id: 5, name: "服务停止", group: "repair" },
  { id: 6, name: "端口配置冲突", group: "repair" },
  { id: 7, name: "HTTP 500", group: "repair" },
  { id: 8, name: "配置语法错误", group: "repair" },
  { id: 9, name: "SSH 查询连接中断", group: "recovery" },
  { id: 10, name: "长任务连续查询失败", group: "recovery" },
  { id: 11, name: "后台进程重启", group: "recovery" },
  { id: 12, name: "长任务超时核实", group: "recovery" },
] as const;
export interface BenchmarkCell {
  id: string;
  scenario: number;
  mode: BenchmarkMode;
  root: string;
  unit: string;
  project: string;
  port: number;
  phase:
    | "pending"
    | "preparing"
    | "running"
    | "evaluating"
    | "completed"
    | "environment_blocked"
    | "setup_failed";
  seedTaskId?: string;
  source?: "agent" | "workflow";
  sourceId?: string;
  agentId?: string;
  workflowId?: string;
  startedAt?: string;
  finishedAt?: string;
  deadline?: string;
  error?: string;
  steps?: number;
  executionTaskIds?: string[];
  injections: { at: string; kind: string; taskId: string }[];
  evidence?: { at: string; code: number; stdout: string; stderr: string };
  trace?: ExecutionTrace;
  success?: boolean;
  claimedSuccess?: boolean;
  incorrectSuccessClaim?: boolean;
  recoverySuccess?: boolean;
}
export interface BenchmarkRun {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "paused" | "completed" | "stopped";
  providerId: string;
  hostId: string;
  sudo: boolean;
  identity: string;
  model: string;
  protocol: string;
  maxSteps: number;
  caseTimeoutSeconds: number;
  allowRestart: boolean;
  interactionPolicy?: "pause" | "record_failure";
  riskEngineVersion?: string;
  cells: BenchmarkCell[];
  summary: string;
}
