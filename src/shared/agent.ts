import type { SreSkill, SreSkillMode } from "./sre-skills";
import type { ToolPin } from "./studio";
export type AgentPermission = "advice" | "readonly" | "confirm" | "autonomous";
export type AgentTarget =
  | { kind: "local"; root: string }
  | { kind: "ssh"; root: string; hostId: string; sudo: boolean };
export type AgentStatus =
  | "running"
  | "pausing"
  | "paused"
  | "awaiting_approval"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";
export interface AgentToolCall {
  tool:
    | "list_files"
    | "read_file"
    | "write_file"
    | "make_directory"
    | "inspect_system"
    | "run_command"
    | "http_check"
    | "host_resources"
    | "clock_status"
    | "network_listeners"
    | "service_status"
    | "service_logs"
    | "container_logs"
    | "monitoring_query"
    | "update_plan"
    | "service_action"
    | "compose_action"
    | "compose_check"
    | "verify_service"
    | "verify_file"
    | "verify_package"
    | (string & {});
  arguments: Record<string, unknown>;
}
export interface AgentStep {
  approval?:{requestedAt:string;decidedAt?:string;approved?:boolean};
  risk?:import("./risk").RiskAssessment;
  id: string;
  createdAt: string;
  summary: string;
  call?: AgentToolCall;
  status:
    "thinking" | "pending" | "running" | "succeeded" | "failed" | "rejected";
  output?: string;
  taskId?: string;
  uncertain?: boolean;
  startedAt?: string;
  finishedAt?: string;
  toolVersion?: string;
  toolDigest?: string;
  toolRisk?: number;
}
export interface AgentPlan {
  goal: string;
  steps: {
    id: string;
    title: string;
    status: "pending" | "running" | "completed" | "blocked";
    evidence: string[];
  }[];
  acceptance: string[];
  checks?: AgentToolCall[];
}
export interface AgentSession {
  modelUsageCaptured?:boolean;
  recoveryEvents?:{at:string;status:string;summary:string}[];
  resumeEvents?:{at:string;summary:string}[];
  agentSnapshot?:import("./studio").AgentRuntimeSnapshot;
  skillIds?: string[];
  toolPins?: ToolPin[];
  executionVersion?: number;
  activeInstruction?: string;
  turnStart?: number;
  plan?: AgentPlan;
  skillHistory?: { fromStep: number; skills: SreSkill[] }[];
  id: string;
  title?: string;
  skillMode?: SreSkillMode;
  skills?: SreSkill[];
  providerId: string;
  permission: AgentPermission;
  target: AgentTarget;
  instruction: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  steps: AgentStep[];
  summary: string;
  maxSteps: number;
  verification: string[];
}
export const permissionLabels: Record<AgentPermission, string> = {
  advice: "分析建议",
  readonly: "只读诊断",
  confirm: "确认执行",
  autonomous: "自主执行",
};
export const agentStatusLabels: Record<AgentStatus, string> = {
  running: "执行中",
  pausing: "正在暂停",
  paused: "已暂停",
  awaiting_approval: "等待确认",
  awaiting_input: "等待补充",
  completed: "已结束",
  failed: "失败",
  cancelled: "已停止",
  unknown: "待核实",
};
