import { promises as fs } from "node:fs";
import { z } from "zod";
import type { Backend } from "../core/backend";
import type { AgentSession } from "../../shared/agent";
import type { WorkflowRun, WorkflowNodeState } from "../../shared/workflow";
import type { ExecutionTrace, ExecutionEvent, ModelUsage } from "../../shared/trace";
import { sanitizeContext } from "./ai";
const query=z.object({source:z.enum(["agent","workflow"]),id:z.string().min(1).max(100)}).strict();
const verifyTools=new Set(["verify_service","verify_file","verify_package","http_check","compose_check"]);
function duration(start?:string,end?:string){const ms=start&&end?Date.parse(end)-Date.parse(start):NaN;return Number.isFinite(ms)&&ms>=0?{durationMs:ms}:{};}
export class ExecutionTraceService {
 constructor(private core:Backend){for(const u of core.store.list<ModelUsage>("modelUsage"))if(u.status==="running")core.store.put("modelUsage",{...u,status:"unknown",error:"应用重启，接口调用结果未知"});}
 private safe<T>(value:T):T {const strip=(v:any):any=>Array.isArray(v)?v.map(strip):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).filter(([k])=>!/[a-z]*(?:password|privatekey|apikey|authorization|chain.of.thought|reasoning_content|thinking)/i.test(k)).map(([k,v])=>[k,strip(v)])):v;return JSON.parse(this.core.store.redact(sanitizeContext(JSON.stringify(strip(value))),{shortSecrets:"contextual"}));}
 private base(source:"agent"|"workflow",s:{id:string;createdAt:string;updatedAt:string;status:string;target:AgentSession["target"];permission:AgentSession["permission"];summary:string},title:string):ExecutionTrace{return {schemaVersion:1,id:s.id,source,title,status:s.status,createdAt:s.createdAt,updatedAt:s.updatedAt,target:s.target,permission:s.permission,summary:s.summary,versions:{},events:[],metrics:{toolCalls:0,toolFailures:0,modelCalls:0,inputTokens:null,outputTokens:null,totalTokens:null,approvalRequests:0,humanApprovals:0,humanInterventions:0,riskBlocks:0,verificationFailures:0,recoveryAttempts:0,resumeSuccesses:0,elapsedMs:Math.max(0,Date.parse(s.updatedAt)-Date.parse(s.createdAt))},childTraceIds:[]};}
 get(source:"agent"|"workflow",id:string):ExecutionTrace {
  let trace:ExecutionTrace;
  if(source==="agent"){
   const s=this.core.store.get<AgentSession>("aiSessions",id);if(!s)throw new Error("Agent记录不存在");trace=this.base(source,s,s.title??s.instruction.slice(0,80));
   trace.versions=s.agentSnapshot??{skills:s.skills??[],tools:s.toolPins??[],providerId:s.providerId,legacy:!s.toolPins};
   trace.events.push({id:"start",at:s.createdAt,kind:"run.started",summary:"加载目标、权限和固定版本",data:{target:s.target,permission:s.permission,versions:trace.versions}});
   for(const step of s.steps){if(step.call){trace.metrics.toolCalls++;if(step.status==="failed")trace.metrics.toolFailures++;if(step.risk?.action==="deny")trace.metrics.riskBlocks++;if(verifyTools.has(step.call.tool)&&step.status==="failed")trace.metrics.verificationFailures++;trace.events.push({id:`${step.id}-call`,at:step.startedAt??step.createdAt,kind:step.call.tool==="update_plan"?"plan":verifyTools.has(step.call.tool)?"verify.requested":"tool.call",summary:step.summary,tool:step.call.tool,data:{stepId:step.id,call:step.call,toolVersion:step.toolVersion,toolDigest:step.toolDigest,taskId:step.taskId}});if(step.risk)trace.events.push({id:`${step.id}-risk`,at:step.createdAt,kind:"risk",summary:step.risk.reason,tool:step.call.tool,risk:step.risk,data:step.risk});
    if(step.approval){trace.metrics.approvalRequests++;if(step.approval.approved===true)trace.metrics.humanApprovals++;if(step.approval.decidedAt)trace.metrics.humanInterventions++;trace.events.push({id:`${step.id}-approval`,at:step.approval.decidedAt??step.approval.requestedAt,kind:"approval",summary:step.approval.approved===true?"用户批准具体操作":step.approval.approved===false?"用户拒绝具体操作":"等待用户审批",tool:step.call.tool,status:step.approval.approved===true?"approved":step.approval.approved===false?"rejected":"awaiting_approval",data:{...step.approval,stepId:step.id,call:step.call}});}
   }else if(step.summary==="用户补充")trace.metrics.humanInterventions++;
   trace.events.push({id:step.id,at:step.finishedAt??step.createdAt,kind:step.call?verifyTools.has(step.call.tool)?"verify.result":"tool.result":"decision.summary",summary:step.summary,tool:step.call?.tool,status:step.uncertain?"unknown":step.status,risk:step.risk,...duration(step.startedAt,step.finishedAt),...(step.call?{evidenceId:step.id}:{}),data:{status:step.status,output:step.output,taskId:step.taskId,uncertain:step.uncertain}});
   }
   for(const [i,event] of (s.recoveryEvents??[]).entries()){trace.metrics.recoveryAttempts++;if(event.status==="paused")trace.metrics.resumeSuccesses++;trace.events.push({id:`recovery-${i}`,at:event.at,kind:"recovery",summary:event.summary,data:{status:event.status}});}
   trace.metrics.resumeSuccesses=s.status==="completed"?(s.resumeEvents?.length??0):0;for(const [i,event] of (s.resumeEvents??[]).entries())trace.events.push({id:`resume-${i}`,at:event.at,kind:"run.resumed",summary:event.summary});
   const usage=this.core.store.list<ModelUsage>("modelUsage").filter(u=>u.requestId===`session-${id}`);trace.metrics.modelCalls=s.modelUsageCaptured||usage.length?usage.length:null;
   for(const key of ["inputTokens","outputTokens","totalTokens"] as const)trace.metrics[key]=usage.length&&usage.every(u=>u[key]!==undefined)?usage.reduce((sum,u)=>sum+(u[key]??0),0):null;
   for(const u of usage)trace.events.push({id:u.id,at:u.finishedAt??u.startedAt,kind:"model.call",summary:`${u.model} · ${u.status}`,status:u.status,...duration(u.startedAt,u.finishedAt),data:u});
   trace.events.push({id:"final",at:s.updatedAt,kind:"run.status",summary:s.summary,status:s.status,data:{status:s.status,plan:s.plan,verification:s.verification}});
  }else{
   const r=this.core.store.get<WorkflowRun>("workflowRuns",id);if(!r)throw new Error("Workflow记录不存在");trace=this.base(source,r,r.definition.name);trace.versions={workflow:{id:r.definition.id,version:r.definition.version,digest:r.definition.digest},parentAgent:r.parentAgent,agents:r.agents,skills:r.skills,tools:r.toolPins};
   trace.events=r.events.map(e=>{const node=r.definition.nodes.find(n=>n.id===e.nodeId),recorded=e.data&&typeof e.data==="object"?e.data as Partial<WorkflowNodeState>:undefined;return {id:e.id,at:e.at,kind:e.kind,summary:e.summary,tool:recorded?.call?.tool??(node&&["Tool","Verify"].includes(node.type)?node.config.tool:undefined),status:recorded?.status??(e.kind==="node.completed"?"succeeded":undefined),risk:recorded?.risk??(e.kind==="risk.assessed"?e.data as WorkflowNodeState["risk"]:undefined),...duration(recorded?.startedAt,recorded?.finishedAt),...(e.kind==="node.completed"?{evidenceId:e.id}:{}),data:{nodeId:e.nodeId,data:e.data,taskId:e.taskId}};});
   for(const [nodeId,state] of Object.entries(r.states)){if(state.call){trace.metrics.toolCalls+=state.attempts;if(state.status==="failed")trace.metrics.toolFailures++;if(state.risk?.action==="deny")trace.metrics.riskBlocks++;if(verifyTools.has(state.call.tool)&&state.status==="failed")trace.metrics.verificationFailures++;}if(state.agentSessionId)trace.childTraceIds.push(state.agentSessionId);}
   trace.metrics.approvalRequests=r.events.filter(e=>e.kind==="approval.requested").length;trace.metrics.humanApprovals=r.events.filter(e=>e.kind==="approval.granted").length;trace.metrics.humanInterventions=r.events.filter(e=>["approval.granted","approval.rejected","input.supplied"].includes(e.kind)).length;trace.metrics.recoveryAttempts=r.events.filter(e=>e.kind.startsWith("recovery.")).length;trace.metrics.resumeSuccesses=r.events.filter(e=>e.kind==="recovery.completed").length;
   const children=trace.childTraceIds.flatMap(id=>{try{return [this.get("agent",id)];}catch{return [];}});
   trace.metrics.toolFailures=r.events.filter(e=>e.kind==="node.failed"&&["Tool","Verify"].includes(r.definition.nodes.find(n=>n.id===e.nodeId)?.type??"")).length;
   trace.metrics.verificationFailures=r.events.filter(e=>e.kind==="node.failed"&&r.definition.nodes.find(n=>n.id===e.nodeId)?.type==="Verify").length;
   trace.metrics.resumeSuccesses=r.status==="completed"?r.events.filter(e=>e.kind==="run.resumed").length:0;
   for(const child of children)trace.events.push(...child.events.map(e=>({...e,id:`${child.id}:${e.id}`,summary:`子Agent：${e.summary}`,data:{childTraceId:child.id,data:e.data}})));
   for(const c of children){for(const k of ["toolCalls","toolFailures","approvalRequests","humanApprovals","humanInterventions","riskBlocks","verificationFailures","recoveryAttempts","resumeSuccesses"] as const)trace.metrics[k]+=c.metrics[k];}
   trace.metrics.modelCalls=children.every(c=>c.metrics.modelCalls!==null)?children.reduce((sum,c)=>sum+(c.metrics.modelCalls??0),0):null;
   for(const k of ["inputTokens","outputTokens","totalTokens"] as const)trace.metrics[k]=children.length&&children.every(c=>c.metrics[k]!==null)?children.reduce((sum,c)=>sum+(c.metrics[k]??0),0):null;
  }
  trace.events.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));return this.safe(trace);
 }
 list(){return [...this.core.store.list<AgentSession>("aiSessions").map(s=>({source:"agent" as const,id:s.id,title:s.title??s.instruction.slice(0,80),status:s.status,createdAt:s.createdAt})),...this.core.store.list<WorkflowRun>("workflowRuns").map(r=>({source:"workflow" as const,id:r.id,title:r.definition.name,status:r.status,createdAt:r.createdAt}))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 markdown(t:ExecutionTrace){const escape=(v:unknown)=>String(v).replace(/\|/g,"\\|").replace(/[\r\n]+/g," ");return `# ${escape(t.title)}\n\n运行：${t.id} · ${t.source} · ${t.status}\n\n${t.summary}\n\n## 版本与目标\n\n\`\`\`json\n${JSON.stringify({versions:t.versions,target:t.target,permission:t.permission},null,2)}\n\`\`\`\n\n## 指标\n\n\`\`\`json\n${JSON.stringify(t.metrics,null,2)}\n\`\`\`\n\n## 时间线\n\n| 时间 | 类型 | 摘要 |\n|---|---|---|\n${t.events.map(e=>`| ${escape(e.at)} | ${escape(e.kind)} | ${escape(e.summary)} |`).join("\n")}\n\n## 结构化证据\n\n\`\`\`json\n${JSON.stringify(t.events,null,2)}\n\`\`\`\n\n子Agent Trace：${t.childTraceIds.join(", ")||"无"}。未采集隐藏思维链。\n`;}
 async handle(method:string,input:unknown={}){
  if(method==="studio.trace.list"){z.object({}).strict().parse(input);return this.safe(this.list());}
  if(method==="studio.trace.get"){const p=query.parse(input);return this.get(p.source,p.id);}
  if(method==="studio.trace.export"){const p=query.extend({format:z.enum(["json","markdown"])}).parse(input),trace=this.get(p.source,p.id);const file=await this.core.handle("dialog.open",{mode:"save"});if(!file)return null;const content=p.format==="json"?JSON.stringify(trace,null,2):this.markdown(trace);await fs.writeFile(String(file),content,{encoding:"utf8",mode:0o600});return {saved:true,eventCount:trace.events.length};}
  throw new Error("不支持的Trace操作");
 }
}
