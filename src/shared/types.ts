export type TaskStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export interface Host {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  group: string;
  tags: string[];
  authType: "password" | "key";
  credentialId: string;
  fingerprint?: string;
}
export interface HostInput extends Omit<
  Host,
  "id" | "credentialId" | "fingerprint"
> {
  id?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  sudoPassword?: string;
}
export interface Task {
  id: string;
  hostId: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  logs: string;
  exitCode?: number;
  unit?: string;
  step?: string;
}
export interface ScriptVersion {
  id: string;
  name: string;
  body: string;
  version: number;
  createdAt: string;
}
export interface ExecutionSpec {
  hostId: string;
  title: string;
  script: string;
  sudo: boolean;
  timeout: number;
}
export interface ExecutionPreview extends ExecutionSpec {
  token: string;
  digest: string;
  username: string;
  hostName: string;
}
export interface DeploymentSpec {
  id: string;
  hostId: string;
  name: string;
  sourceType: "local" | "git";
  source: string;
  gitRef: string;
  gitCredentialId?: string;
  template: "static" | "node" | "python" | "dockerfile";
  runtime: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  outputDir: string;
  containerPort: number;
  publicPort: number;
  domain: string;
  healthPath: string;
  env: Record<string, string>;
  volumes: { source: string; target: string }[];
}
export interface DeploymentRelease {
  id: string;
  deploymentId: string;
  taskId: string;
  createdAt: string;
  image: string;
  status: string;
}
export interface MonitoringStack {
  id: string;
  hostId: string;
  name: string;
  targets: { hostId: string; address: string }[];
  retentionDays: number;
  cpuThreshold: number;
  memoryThreshold: number;
  diskThreshold: number;
  duration: string;
  groupWait: string;
  groupInterval: string;
  repeatInterval: string;
  smtpHost: string;
  smtpFrom: string;
  smtpTo: string;
  smtpUser: string;
  smtpCredentialId?: string;
  webhook: string;
  grafanaCredentialId?: string;
}
export interface AIProvider {
  id: string;
  name: string;
  kind: "model" | "agent";
  baseUrl: string;
  model: string;
  credentialId?: string;
  timeout: number;
}
export interface AgentResult {
  summary: string;
  scripts: { name: string; body: string; description: string; sudo: boolean }[];
}
export interface FileEntry {
  name: string;
  path: string;
  size: number;
  directory: boolean;
  modified: number;
}
export interface Snapshot {
  hosts: Host[];
  tasks: Task[];
  scripts: ScriptVersion[];
  deployments: DeploymentSpec[];
  releases: DeploymentRelease[];
  monitoring: MonitoringStack[];
  providers: AIProvider[];
}
export interface AppEvent {
  type: "changed" | "terminal";
  id?: string;
  data?: string;
}
export interface DesktopApi {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  subscribe(callback: (event: AppEvent) => void): () => void;
}
declare global {
  interface Window {
    sre: DesktopApi;
  }
}
