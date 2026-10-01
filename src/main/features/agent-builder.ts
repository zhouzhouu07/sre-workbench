import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Backend } from "../core/backend";
import type { AgentDefinition, AgentRuntimeSnapshot } from "../../shared/studio";
import type { AIProvider, Host } from "../../shared/types";
import { permissionSchema, targetSchema } from "./agent-contract";
import { sanitizeContext } from "./ai";
const id=z.string().min(1).max(100),str=z.string().trim().min(1).max(100);
const configSchema=z.object({name:str,description:z.string().trim().max(3000),icon:z.string().max(20),category:str,providerId:z.string().max(100),permissionCeiling:permissionSchema,riskPolicy:z.enum(["cautious","balanced","autonomous"]),toolIds:z.array(id).max(80),skillIds:z.array(id).max(8),workflowId:id.optional(),maxSteps:z.number().int().min(1).max(100),maxRuntimeSeconds:z.number().int().min(30).max(86400),targetHostIds:z.array(id).max(200),rootPrefix:z.string().min(1).max(4096).refine(s=>s.startsWith("/")&&!s.includes("\0")&&!s.split("/").includes("..")),acceptanceCriteria:z.array(z.string().trim().min(1).max(1000)).min(1).max(20),enabled:z.boolean()}).strict();
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const now=()=>new Date().toISOString();
const rank={advice:0,readonly:1,confirm:2,autonomous:3};
export class AgentBuilder {
 constructor(private core:Backend,private changed:()=>void){}
 private templates():AgentDefinition[]{
  const read=this.core.toolRegistry.list().filter(t=>t.permissionRequirement!=="mutation").map(t=>t.id),all=this.core.toolRegistry.list().filter(t=>t.source==="builtin").map(t=>t.id);
  return [
   {id:"template.inspection",name:"Linux巡检Agent",skillIds:["linux-inspection"],toolIds:read,permissionCeiling:"readonly" as const},
   {id:"template.web-diagnosis",name:"Web服务故障诊断Agent",skillIds:["incident-repair"],toolIds:read,permissionCeiling:"readonly" as const},
   {id:"template.deployment",name:"应用部署Agent",skillIds:["application-deployment"],toolIds:all,permissionCeiling:"confirm" as const},
   {id:"template.compose",name:"Docker Compose运维Agent",skillIds:["incident-repair"],toolIds:all,permissionCeiling:"confirm" as const},
  ].map(s=>{const value={...s,description:"通过Skill、Tool白名单和既有持久执行Runtime完成任务。请先配置模型引用。",icon:"🛠",category:"SRE",providerId:"",riskPolicy:"balanced" as const,maxSteps:40,maxRuntimeSeconds:1800,targetHostIds:[],rootPrefix:"/",acceptanceCriteria:["基于实际证据报告结果，变更后必须独立验收"],enabled:true,source:"template" as const,version:"1.0.0",createdAt:"2026-09-30T00:00:00.000Z",updatedAt:"2026-09-30T00:00:00.000Z"};return {...value,digest:hash(value)};});
 }
 get(agentId:string){const a=this.core.store.get<AgentDefinition>("agents",agentId)??this.templates().find(a=>a.id===agentId);if(!a)throw new Error("Agent不存在");return a;}
 list(){const custom=this.core.store.list<AgentDefinition>("agents");return [...this.templates().filter(t=>!custom.some(c=>c.id===t.id)),...custom];}
 private clean<T>(v:T):T {const text=JSON.stringify(v);if(this.core.store.redact(sanitizeContext(text),{shortSecrets:"contextual"})!==text)throw new Error("Agent配置不得包含凭据，请仅引用已有模型配置");return v;}
 save(input:unknown){const {id:agentId,expectedDigest,...config}=z.object({id:id.optional(),expectedDigest:id.optional(),...configSchema.shape}).strict().parse(input);this.clean(config);
  const old=agentId?this.get(agentId):undefined;if(old&&old.digest!==expectedDigest)throw new Error("Agent已变化，请刷新后重新编辑");
  if(new Set(config.toolIds).size!==config.toolIds.length||new Set(config.skillIds).size!==config.skillIds.length)throw new Error("Tool/Skill绑定重复");
  for(const id of config.toolIds)this.core.toolRegistry.get(id);for(const id of config.skillIds)this.core.skillRegistry.get(id);
  if(config.workflowId)this.core.workflowRegistry.get(config.workflowId);
  if(config.providerId){const p=this.core.store.get<AIProvider>("providers",config.providerId);if(!p||p.kind!=="model")throw new Error("请选择已有模型API配置");}
  for(const id of config.targetHostIds)if(!this.core.store.get("hosts",id))throw new Error("目标服务器不存在");
  const a:AgentDefinition={...config,id:old?.id??`agent.${randomUUID()}`,version:old?`1.0.${Number(old.version.split(".")[2])+1}`:"1.0.0",source:old?.source??"custom",createdAt:old?.createdAt??now(),updatedAt:now(),digest:""};a.digest=hash(a);this.core.store.put("agents",a);this.changed();return a;
 }
 clone(agentId:string){const a=this.get(agentId);const {id,version,source,createdAt,updatedAt,digest,...config}=a;return this.save({...config,name:`${a.name} 副本`,enabled:false});}
 enable(agentId:string,enabled:boolean){const a=this.get(agentId);const {id,version,source,createdAt,updatedAt,digest,...config}=a;return this.save({...config,id,enabled,expectedDigest:digest});}
 remove(agentId:string){if(this.get(agentId).source==="template")throw new Error("系统模板不能删除，可禁用或克隆");this.core.store.remove("agents",agentId);this.changed();return true;}
 prepare(input:unknown,allowWorkflow=false):{params:Record<string,unknown>;snapshot:AgentRuntimeSnapshot}{
  const p=z.object({id,target:targetSchema,permission:permissionSchema,instruction:z.string().trim().min(1).max(30000)}).strict().parse(input),a=this.get(p.id);
  if(!a.enabled)throw new Error("Agent已禁用");if(p.target.kind!=="ssh")throw new Error("Agent Studio仅支持SSH服务器");
  if(rank[p.permission]>rank[a.permissionCeiling])throw new Error("请求权限超过Agent上限");
  const host=this.core.store.get<Host>("hosts",p.target.hostId);if(!host?.fingerprint)throw new Error("请选择已验证指纹的服务器");
  if(a.targetHostIds.length&&!a.targetHostIds.includes(host.id))throw new Error("服务器不在Agent允许范围");
  const root=path.posix.normalize(p.target.root),prefix=path.posix.normalize(a.rootPrefix);if(root!==prefix&&!root.startsWith(prefix.endsWith("/")?prefix:prefix+"/"))throw new Error("工作目录超出Agent目标限制");
  if(a.workflowId&&!allowWorkflow)throw new Error("该Agent绑定了工作流，请从Workflow入口运行");
  const provider=this.core.store.get<AIProvider>("providers",a.providerId);if(!provider||provider.kind!=="model")throw new Error("Agent尚未绑定可用模型API配置");
  const tools=a.toolIds.map(id=>{const t=this.core.toolRegistry.get(id);if(!t.enabled)throw new Error(`Tool已禁用：${id}`);return this.core.toolRegistry.version(id);});
  const skills=this.core.skillRegistry.snapshot(a.skillIds);for(const s of a.skillIds){const skill=this.core.skillRegistry.get(s);const missing=skill.requiredTools.filter(id=>!a.toolIds.includes(id));if(missing.length)throw new Error(`Skill必需Tool不在Agent白名单：${missing.join(", ")}`);}
  const snapshot:AgentRuntimeSnapshot={configIdentity:hash({provider,host}),definition:structuredClone(a),tools,skills,modelProfile:{id:provider.id,name:provider.name,protocol:provider.protocol??"openai",baseUrl:provider.baseUrl,model:provider.model??""},target:{...p.target,root},permission:p.permission,createdAt:now(),deadline:new Date(Date.now()+a.maxRuntimeSeconds*1000).toISOString()};
  return {params:{providerId:a.providerId,permission:p.permission,target:snapshot.target,instruction:p.instruction,maxSteps:a.maxSteps,skillIds:a.skillIds,skillMode:"none"},snapshot};
 }
 async handle(method:string,input:unknown={}){
  if(method==="studio.agent.list"){z.object({}).strict().parse(input);return this.list();}
  if(method==="studio.agent.save")return this.save(input);
  if(method==="studio.agent.clone")return this.clone(z.object({id}).strict().parse(input).id);
  if(method==="studio.agent.remove")return this.remove(z.object({id}).strict().parse(input).id);
  if(method==="studio.agent.enable"){const p=z.object({id,enabled:z.boolean()}).strict().parse(input);return this.enable(p.id,p.enabled);}
  if(method==="studio.agent.export"){const a=this.get(z.object({id}).strict().parse(input).id);const {id:_,version,source,createdAt,updatedAt,digest,...config}=a;const file=await this.core.handle("dialog.open",{mode:"save"});if(!file)return null;await fs.writeFile(String(file),JSON.stringify(this.clean({format:"sre-agent-v1",version,config}),null,2),{encoding:"utf8",mode:0o600});return {saved:true};}
  if(method==="studio.agent.import"){z.object({}).strict().parse(input);const file=await this.core.handle("dialog.open",{mode:"file"});if(!file)return null;const st=await fs.lstat(String(file));if(!st.isFile()||st.isSymbolicLink()||st.size>100000)throw new Error("Agent文件无效或超过100KB");const data=z.object({format:z.literal("sre-agent-v1"),version:z.string(),config:configSchema}).strict().parse(JSON.parse(await fs.readFile(String(file),"utf8")));return this.save({...data.config,enabled:false});}
  throw new Error("不支持的Agent Builder操作");
 }
}
