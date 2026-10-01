import type { AgentPermission, AgentTarget, AgentToolCall } from "./agent";
import type { AgentRuntimeSnapshot, SkillSnapshot, ToolPin } from "./studio";
export const workflowNodeTypes=["Start","Input","Agent","Skill","Tool","Condition","Approval","Verify","Retry","Wait","Output","End"] as const;
export type WorkflowNodeType=typeof workflowNodeTypes[number];
export interface WorkflowNode {id:string;type:WorkflowNodeType;label:string;x:number;y:number;config:Record<string,any>;next?:string;onFailure?:string;otherwise?:string}
export interface WorkflowDefinition {id:string;name:string;description:string;version:string;digest:string;nodes:WorkflowNode[];source:"template"|"custom";createdAt:string;updatedAt:string}
export interface WorkflowNodeState {agentToolsAccounted?:boolean;awaitingApproval?:boolean;risk?:import("./risk").RiskAssessment;status:"running"|"succeeded"|"failed"|"unknown";startedAt:string;finishedAt?:string;output?:unknown;error?:string;taskId?:string;agentSessionId?:string;dueAt?:string;attempts:number;call?:AgentToolCall}
export interface WorkflowEvent {id:string;at:string;nodeId:string;kind:string;summary:string;taskId?:string;data?:unknown}
export interface WorkflowRun {
 parentAgent?:AgentRuntimeSnapshot;
 toolCalls?:number;
 id:string;definition:WorkflowDefinition;target:AgentTarget;permission:AgentPermission;input:Record<string,unknown>;identity:string;
 toolPins:ToolPin[];skills:Record<string,SkillSnapshot>;agents:Record<string,{params:Record<string,unknown>;snapshot:AgentRuntimeSnapshot}>;activeSkills:string[];
 status:"running"|"paused"|"awaiting_input"|"awaiting_approval"|"awaiting_agent"|"unknown"|"completed"|"failed"|"cancelled";
 current:string;states:Record<string,WorkflowNodeState>;outputs:Record<string,unknown>;retries:Record<string,number>;events:WorkflowEvent[];
 createdAt:string;updatedAt:string;deadline:string;transitions:number;lastMutation:number;lastVerify:number;summary:string;
 pending?:{nodeId:string;approvalNodeId?:string;call:AgentToolCall;digest:string;risk:number;assessment?:import("./risk").RiskAssessment;target:AgentTarget};approved?:string;
}
