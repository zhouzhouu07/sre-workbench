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
    | "http_check";
  arguments: Record<string, unknown>;
}
export interface AgentStep {
  id: string;
  createdAt: string;
  summary: string;
  call?: AgentToolCall;
  status:
    "thinking" | "pending" | "running" | "succeeded" | "failed" | "rejected";
  output?: string;
  taskId?: string;
}
export interface AgentSession {
  id: string;
  title?: string;
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
