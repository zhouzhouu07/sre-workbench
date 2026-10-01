import type { AgentPermission, AgentTarget } from "./agent";

export type JsonSchema = Record<string, unknown>;
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  source: "builtin" | "imported";
  category: string;
  targetType: "ssh" | "both";
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissionRequirement: "readonly" | "mutation" | "plan";
  baseRisk: number;
  timeout: number;
  enabled: boolean;
  executorType: "builtin" | "remote-script" | "http";
  verificationCapability: boolean;
  createdAt: string;
  updatedAt: string;
  digest: string;
  readme?: string;
}
export interface ToolPackageManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  type: "remote-script" | "http";
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permission: "readonly" | "confirm" | "autonomous";
  risk: number;
  timeout: number;
  target: "ssh";
  verification: false;
  script?: string;
  url?: string;
}
export interface ToolPackagePreview {
  token: string;
  definition: ToolDefinition;
  script?: string;
  url?: string;
  warnings: string[];
}
export interface ToolUsage {
  risk?:import("./risk").RiskAssessment;
  id: string;
  toolId: string;
  version: string;
  digest: string;
  target: AgentTarget;
  permission: AgentPermission;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "succeeded" | "failed" | "unknown" | "rejected";
  taskId?: string;
  summary?: string;
}
export type ToolPin = Pick<ToolDefinition, "id" | "version" | "digest">;
export interface SkillDefinition {
  id:string; name:string; version:string; description:string; triggers:string[];
  instructions:string; requiredTools:string[]; optionalTools:string[];
  constraints:string[]; riskHints:string[]; acceptanceCriteria:string[];
  source:"builtin"|"imported"; enabled:boolean; digest:string;
  createdAt:string; updatedAt:string; readme:string;
}
export interface SkillSnapshot {
  id:string; name:string; version:string; instructions:string;
  skillId:string; skillVersion:string; instructionsSnapshot:string;
  toolDependencies:ToolPin[]; acceptanceSnapshot:string[];
  constraints:string[]; riskHints:string[]; digest:string;
}
export interface SkillPackagePreview {token:string;definition:SkillDefinition;upgrade:boolean;missingTools:string[]}
export interface AgentDefinition {
 id:string;name:string;description:string;icon:string;category:string;version:string;
 providerId:string;permissionCeiling:import("./agent").AgentPermission;
 riskPolicy:"cautious"|"balanced"|"autonomous";toolIds:string[];skillIds:string[];
 workflowId?:string;maxSteps:number;maxRuntimeSeconds:number;targetHostIds:string[];
 rootPrefix:string;acceptanceCriteria:string[];enabled:boolean;source:"template"|"custom";
 createdAt:string;updatedAt:string;digest:string;
}
export interface AgentRuntimeSnapshot {
 configIdentity?:string;
 definition:AgentDefinition;skills:SkillSnapshot[];tools:ToolPin[];
 modelProfile:{id:string;name:string;protocol:string;baseUrl:string;model:string};
 target:AgentTarget;permission:import("./agent").AgentPermission;
 workflow?:{id:string;version:string;digest:string};createdAt:string;deadline:string;
}
