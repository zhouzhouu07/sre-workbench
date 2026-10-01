import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Backend } from "../core/backend";
import type { AgentService } from "./agent";
import type { AgentSession, AgentToolCall } from "../../shared/agent";
import type { WorkflowRun, WorkflowNode, WorkflowNodeState } from "../../shared/workflow";
import type { Task } from "../../shared/types";
import type { AgentRuntimeSnapshot } from "../../shared/studio";
import { permissionSchema, targetSchema } from "./agent-contract";
import { condition, resolveMapping, validateMapping } from "./workflow-contract";
import { workflowHash } from "./workflow-registry";
import { UncertainExecution } from "./agent-tools";
import { sanitizeContext } from "./ai";
const id=z.string().min(1).max(100),now=()=>new Date().toISOString();
const permissions=["advice","readonly","confirm","autonomous"] as const;
type Active={controller:AbortController;pause:boolean;job?:Promise<void>};
export class WorkflowRuntime {
 private active=new Map<string,Active>();private closing=false;
 constructor(private core:Backend,private agent:AgentService,private changed:()=>void){
  for(const r of core.store.list<WorkflowRun>("workflowRuns"))if(["running","awaiting_agent","awaiting_approval"].includes(r.status)){if(r.status==="awaiting_approval"&&r.pending?.nodeId===r.current&&r.states[r.current]&&!r.states[r.current].taskId)r.states[r.current].awaitingApproval=true;r.status="unknown";r.pending=undefined;r.approved=undefined;r.summary="应用重启，请核实远端和Agent状态；不会重放已完成节点";this.save(r);}
 }
 private clean<T>(v:T):T{return JSON.parse(this.core.store.redact(sanitizeContext(JSON.stringify(v)),{shortSecrets:"contextual"}));}
 private save(r:WorkflowRun){r.updatedAt=now();this.core.store.put("workflowRuns",r);this.changed();}
 private event(r:WorkflowRun,kind:string,summary:string,data?:unknown){r.events.push({id:randomUUID(),at:now(),nodeId:r.current,kind,summary:this.clean(summary),...(data===undefined?{}:{data:this.clean(data)})});if(r.events.length>1000)r.events.shift();this.save(r);}
 get(runId:string){const r=this.core.store.get<WorkflowRun>("workflowRuns",runId);if(!r)throw new Error("流程运行不存在");return r;}
 private identity(r:Pick<WorkflowRun,"target">){if(r.target.kind!=="ssh")throw new Error("Workflow仅支持SSH目标");return workflowHash(this.core.ssh.host(r.target.hostId));}
 private node(r:WorkflowRun,nodeId=r.current){const n=r.definition.nodes.find(n=>n.id===nodeId);if(!n)throw new Error("执行节点不存在");return n;}
 private call(r:WorkflowRun,n:WorkflowNode){return this.core.toolRegistry.validate({tool:n.config.tool,arguments:resolveMapping(n.config.arguments,{input:r.input,outputs:r.outputs})},r.toolPins.find(t=>t.id===n.config.tool));}
 private riskContext(r:WorkflowRun){return {policy:r.parentAgent?.definition.riskPolicy,verificationPlanned:r.definition.nodes.some(n=>n.type==="Verify")};}
 private assess(r:WorkflowRun,call:AgentToolCall){return this.core.toolRegistry.assess(r.permission,call,r.target,this.riskContext(r));}
 private binding(r:WorkflowRun,n:WorkflowNode,call:AgentToolCall){return workflowHash({runId:r.id,nodeId:n.id,call,target:r.target,permission:r.permission,tool:r.toolPins.find(t=>t.id===call.tool),risk:this.assess(r,call)});}
 private finishNode(r:WorkflowRun,n:WorkflowNode,state:WorkflowNodeState,output:unknown,next=n.next){state.status="succeeded";state.finishedAt=now();state.output=this.clean(output);r.outputs[n.id]=state.output;this.event(r,"node.completed",`${n.label} 已完成`,{output:state.output,taskId:state.taskId,agentSessionId:state.agentSessionId});if(next)r.current=next;this.save(r);}
 private accountChildTools(r:WorkflowRun,state:WorkflowNodeState,session:AgentSession){
  if(state.agentToolsAccounted)return;
  r.toolCalls=(r.toolCalls??0)+session.steps.filter(s=>s.call).length;
  if(session.steps.some(s=>s.call&&this.core.toolRegistry.mutation(s.call)&&s.status!=="rejected"))r.lastMutation=r.transitions;
  state.agentToolsAccounted=true;this.save(r);
 }
 async runAgent(input:unknown){const {workflowInput,...params}=z.object({id,target:targetSchema,permission:permissionSchema,instruction:z.string().trim().min(1).max(30000),workflowInput:z.record(z.string(),z.unknown()).optional()}).strict().parse(input);const definition=this.core.agentBuilder.get(params.id);if(!definition.workflowId)return this.agent.startDefinition(params);const prepared=this.core.agentBuilder.prepare(params,true);return this.start({id:definition.workflowId,target:params.target,permission:params.permission,input:{...workflowInput,instruction:params.instruction},maxRuntimeSeconds:definition.maxRuntimeSeconds},prepared.snapshot);}
 async startPrepared(input:unknown,runId:string){if(this.core.store.get("workflowRuns",runId))throw new Error("运行ID已存在，禁止重复提交");return this.start(input,undefined,runId);}
 private async start(input:unknown,parent?:AgentRuntimeSnapshot,runId?:string){
  const p=z.object({id,target:targetSchema,permission:permissionSchema,input:z.record(z.string(),z.unknown()),maxRuntimeSeconds:z.number().int().min(30).max(86400).default(3600)}).strict().parse(input);
  if(this.active.size)throw new Error("已有流程执行中");const definition=this.core.workflowRegistry.get(p.id);this.core.workflowRegistry.validate({name:definition.name,description:definition.description,nodes:definition.nodes});
  const target=await this.core.toolRegistry.validateTarget(p.target);if(target.kind!=="ssh")throw new Error("Workflow只支持SSH服务器");validateMapping(p.input);if(JSON.stringify(this.clean(p.input))!==JSON.stringify(p.input))throw new Error("流程输入不得包含凭据");
  const skills:WorkflowRun["skills"]={},agents:WorkflowRun["agents"]={};
  for(const n of definition.nodes){if(n.type==="Skill")skills[n.config.skillId]=this.core.skillRegistry.snapshot([n.config.skillId])[0];
   if(n.type==="Agent"){const a=this.core.agentBuilder.get(n.config.agentId),permission=permissions[Math.min(permissions.indexOf(p.permission),permissions.indexOf(a.permissionCeiling))];agents[n.id]=this.core.agentBuilder.prepare({id:a.id,target,permission,instruction:"执行工作流局部任务"});agents[n.id].snapshot.workflow={id:definition.id,version:definition.version,digest:definition.digest};}
  }
  const toolPins=[...new Set(definition.nodes.filter(n=>["Tool","Verify"].includes(n.type)).map(n=>String(n.config.tool)))].map(toolId=>{if(!this.core.toolRegistry.get(toolId).enabled)throw new Error(`Tool已禁用：${toolId}`);return this.core.toolRegistry.version(toolId);});
  if(parent){parent.workflow={id:definition.id,version:definition.version,digest:definition.digest};for(const t of toolPins)if(!parent.tools.some(p=>p.id===t.id&&p.digest===t.digest))throw new Error(`流程Tool超出父Agent白名单：${t.id}`);for(const child of Object.values(agents)){child.snapshot.tools=child.snapshot.tools.filter(t=>parent.tools.some(p=>p.id===t.id&&p.digest===t.digest));for(const skill of child.snapshot.skills)for(const t of skill.toolDependencies)if(!child.snapshot.tools.some(p=>p.id===t.id))throw new Error(`子Agent技能Tool超出父Agent白名单：${t.id}`);child.snapshot.deadline=parent.deadline;child.snapshot.definition.maxSteps=Math.min(child.snapshot.definition.maxSteps,parent.definition.maxSteps);child.params.maxSteps=child.snapshot.definition.maxSteps;if(parent.definition.riskPolicy==="cautious")child.snapshot.definition.riskPolicy="cautious";}}
  const r:WorkflowRun={id:runId??randomUUID(),parentAgent:parent,definition:structuredClone(definition),target,permission:p.permission,input:p.input,identity:this.identity({target}),toolPins,skills,agents,activeSkills:[],status:"running",current:definition.nodes.find(n=>n.type==="Start")!.id,states:{},outputs:{},retries:{},events:[],createdAt:now(),updatedAt:now(),deadline:parent?.deadline??new Date(Date.now()+p.maxRuntimeSeconds*1000).toISOString(),transitions:0,lastMutation:-1,lastVerify:-1,summary:"流程已启动"};this.event(r,"run.started","加载固定Workflow、Agent、Skill与Tool版本");this.launch(r);return r;
 }
 private launch(r:WorkflowRun){if(this.closing)throw new Error("软件正在退出");if(this.active.size)throw new Error("已有流程执行中");const active:Active={controller:new AbortController(),pause:false};this.active.set(r.id,active);r.status="running";this.save(r);active.job=this.loop(r,active).finally(()=>this.active.delete(r.id));}
 private async wait(ms:number,signal:AbortSignal){if(ms<=0)return;await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error("等待已中断"));};const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});}
 private async loop(r:WorkflowRun,a:Active){
  const timer=setTimeout(()=>a.controller.abort(),Math.max(0,Date.parse(r.deadline)-Date.now()));
  try{while(!this.closing){
   if(a.controller.signal.aborted)throw new Error("执行已停止或达到时间上限");if(a.pause){r.status="paused";r.summary="已在节点边界暂停";this.save(r);return;}
   if(this.identity(r)!==r.identity)throw new Error("服务器身份或凭据配置已变化，拒绝继续到新目标");if(++r.transitions>300)throw new Error("流程超过节点调度上限");
   const n=this.node(r);let state=r.states[n.id];
   if(state?.status==="succeeded"){if(n.type==="End"){r.status="completed";this.save(r);return;}r.current=n.type==="Condition"?(state.output as any)?.result?n.next!:n.otherwise!:n.next!;continue;}
   if(state?.status==="unknown")throw new UncertainExecution("当前节点状态未核实，禁止重放");
   state??={status:"running",startedAt:now(),attempts:1};r.states[n.id]=state;this.event(r,"node.started",`${n.type}：${n.label}`);
   try{
    if(n.type==="Start"){this.finishNode(r,n,state,{started:true});continue;}
    if(n.type==="Input"){const missing=n.config.required.filter((key:string)=>!Object.hasOwn(r.input,key));if(missing.length){r.status="awaiting_input";r.summary=`缺少输入：${missing.join(", ")}`;this.save(r);return;}this.finishNode(r,n,state,r.input);continue;}
    if(n.type==="Skill"){if(!r.activeSkills.includes(n.config.skillId))r.activeSkills.push(n.config.skillId);this.finishNode(r,n,state,{skillId:n.config.skillId,version:r.skills[n.config.skillId].version});continue;}
    if(n.type==="Condition"){const result=condition(n.config,{input:r.input,outputs:r.outputs});this.finishNode(r,n,state,{result},result?n.next:n.otherwise);continue;}
    if(n.type==="Output"){this.finishNode(r,n,state,resolveMapping(n.config.value,{input:r.input,outputs:r.outputs}));continue;}
    if(n.type==="Wait"){state.dueAt??=new Date(Date.now()+n.config.seconds*1000).toISOString();this.save(r);await this.wait(Math.max(0,Date.parse(state.dueAt)-Date.now()),a.controller.signal);this.finishNode(r,n,state,{waitedUntil:state.dueAt});continue;}
    if(n.type==="Retry"){
     const prior=r.states[n.config.retryTarget];if(prior?.status!=="failed"||prior.error?.includes("待核实"))throw new Error("Retry仅接受已确认失败的工具节点");
     const count=r.retries[n.id]??0;if(count>=n.config.maxRetries)throw new Error("已达到重试上限");state.dueAt??=new Date(Date.now()+Math.min(60,n.config.backoff*2**count)*1000).toISOString();this.save(r);await this.wait(Math.max(0,Date.parse(state.dueAt)-Date.now()),a.controller.signal);
     r.retries[n.id]=count+1;this.event(r,"retry",`第${count+1}次显式重试 ${n.config.retryTarget}`);r.states[n.config.retryTarget]={status:"running",startedAt:now(),attempts:prior.attempts+1};delete r.outputs[n.config.retryTarget];delete r.states[n.id];r.current=n.config.retryTarget;this.save(r);continue;
    }
    if(n.type==="Approval"){
     const next=this.node(r,n.config.toolNodeId),call=this.call(r,next),digest=this.binding(r,next,call);
     if(r.approved===digest){this.finishNode(r,n,state,{approved:true,digest});continue;}
     const assessment=this.assess(r,call);if(assessment.action==="deny")throw new Error(assessment.reason);r.pending={nodeId:next.id,approvalNodeId:n.id,call,digest,risk:assessment.score,assessment,target:r.target};r.status="awaiting_approval";r.summary="请审阅绑定的工具、参数、目标和风险";this.event(r,"approval.requested",r.summary,r.pending);return;
    }
    if(n.type==="Agent"){
     if(!state.agentSessionId){
      const frozen=structuredClone(r.agents[n.id]);const instruction=resolveMapping(n.config.instruction,{input:r.input,outputs:r.outputs});if(typeof instruction!=="string"||!instruction.trim())throw new Error("Agent指令映射必须为非空文本");
      if(r.parentAgent){const remaining=r.parentAgent.definition.maxSteps-(r.toolCalls??0);if(remaining<=0)throw new Error("已达到父Agent工具步骤总上限");frozen.snapshot.definition.maxSteps=Math.min(remaining,frozen.snapshot.definition.maxSteps);frozen.params.maxSteps=frozen.snapshot.definition.maxSteps;if(r.parentAgent.definition.riskPolicy==="balanced"&&frozen.snapshot.definition.riskPolicy==="autonomous")frozen.snapshot.definition.riskPolicy="balanced";}
      frozen.params.instruction=instruction;for(const skillId of r.activeSkills){const skill=r.skills[skillId];for(const dep of skill.toolDependencies)if(!frozen.snapshot.tools.some(t=>t.id===dep.id&&t.digest===dep.digest))throw new Error(`Skill依赖不在子Agent快照内：${dep.id}`);if(!frozen.snapshot.skills.some(s=>s.id===skillId))frozen.snapshot.skills.push(skill);}
      state.agentSessionId=randomUUID();this.save(r);await this.agent.startPrepared(frozen.params,frozen.snapshot,state.agentSessionId);
     }
     while(true){const session=await this.agent.handle("ai.session.get",{id:state.agentSessionId}) as AgentSession;
      if(["completed","failed","cancelled"].includes(session.status))this.accountChildTools(r,state,session);
      if(session.status==="completed"){this.finishNode(r,n,state,{sessionId:session.id,summary:session.summary,verification:session.verification});break;}
      if(["failed","cancelled"].includes(session.status))throw new Error(`子Agent${session.status}：${session.summary}`);
      if(session.status==="unknown")throw new UncertainExecution("子Agent结果待核实");
      if(a.pause&&["running","awaiting_input","awaiting_approval"].includes(session.status))await this.agent.handle("ai.session.pause",{id:session.id});
      if(["paused","awaiting_input","awaiting_approval"].includes(session.status)){r.status="awaiting_agent";r.summary=`请在AI助手处理子Agent：${session.title}（${session.status}），处理后继续工作流`;this.save(r);return;}
      if(a.controller.signal.aborted)throw new UncertainExecution("流程停止时子Agent尚未结束，请核实子会话");await this.wait(400,a.controller.signal);
     }continue;
    }
    if(n.type==="Tool"||n.type==="Verify"){
     const call=this.call(r,n),assessment=this.assess(r,call),decision=assessment.action,digest=this.binding(r,n,call);state.call=call;state.risk=assessment;this.event(r,"risk.assessed",assessment.reason,assessment);
     if(decision==="deny")throw new Error(`后端权限拒绝执行：${assessment.reason}`);
     const explicitApproval=r.definition.nodes.some(node=>node.type==="Approval"&&node.config.toolNodeId===n.id);
     if((decision==="confirm"||explicitApproval)&&r.approved!==digest){state.awaitingApproval=true;r.pending={nodeId:n.id,call,digest,risk:assessment.score,assessment,target:r.target};r.status="awaiting_approval";r.summary="工具需要具体操作审批";this.event(r,"approval.requested",r.summary,r.pending);return;}
     const approved=r.approved===digest;state.awaitingApproval=false;r.approved=undefined;r.pending=undefined;if(this.core.toolRegistry.mutation(call))r.lastMutation=r.transitions;this.save(r);
     if(r.parentAgent&&(r.toolCalls??0)>=r.parentAgent.definition.maxSteps)throw new Error("已达到父Agent工具步骤总上限");r.toolCalls=(r.toolCalls??0)+1;this.save(r);
     const local=new AbortController(),timeout=n.config.timeout?setTimeout(()=>local.abort(),n.config.timeout*1000):undefined;let output:any;
     try{output=await this.core.toolRegistry.execute(r.target,r.permission,call,approved,AbortSignal.any([a.controller.signal,local.signal]),taskId=>{state.taskId=taskId;this.event(r,"task.submitted","远端作业已提交",{taskId});},r.toolPins.find(t=>t.id===call.tool),this.riskContext(r));}finally{if(timeout)clearTimeout(timeout);}
     if(output&&typeof output==="object"&&"code" in output&&output.code!==0){state.output=this.clean(output);throw new Error(`工具退出码 ${output.code}`);}
     if(n.type==="Verify")r.lastVerify=r.transitions;this.finishNode(r,n,state,output);continue;
    }
    if(n.type==="End"){
     if(Object.values(r.states).some(s=>s.status==="failed"||s.status==="unknown"))throw new Error("仍有失败/未知节点，不能报告流程完成");if(r.lastMutation>=r.lastVerify&&r.lastMutation>=0)throw new Error("最后变更后缺少独立Verify，拒绝完成");
     this.finishNode(r,n,state,{verified:r.lastVerify>=0});r.status="completed";r.summary="流程结束，已完成实际节点及独立验收要求";this.event(r,"run.completed",r.summary);return;
    }
   }catch(error){const message=error instanceof Error?error.message:String(error);state.error=this.clean(message);state.finishedAt=now();state.status=error instanceof UncertainExecution?"unknown":"failed";this.event(r,"node.failed",message);
    if(error instanceof UncertainExecution||a.controller.signal.aborted)throw error;if(n.onFailure){r.current=n.onFailure;this.save(r);continue;}throw error;
   }
  }}catch(error){const state=r.states[r.current];if(a.controller.signal.aborted&&state?.agentSessionId){await this.agent.handle("ai.session.pause",{id:state.agentSessionId}).catch(()=>{});state.status="unknown";}r.status=error instanceof UncertainExecution||state?.status==="unknown"?"unknown":a.controller.signal.aborted?"cancelled":"failed";r.summary=this.clean(error instanceof Error?error.message:String(error));this.event(r,"run.stopped",r.summary);}finally{clearTimeout(timer);}
 }
 private async reconcile(r:WorkflowRun){
  if(this.active.size)throw new Error("请先暂停执行中的流程");if(r.status!=="unknown")throw new Error("仅待核实流程可恢复");if(this.identity(r)!==r.identity)throw new Error("目标身份已变化");const n=this.node(r),s=r.states[r.current];
  if(s?.taskId){const t=this.core.store.get<Task>("tasks",s.taskId);if(!t||r.target.kind!=="ssh"||t.hostId!==r.target.hostId||t.source!=="ai")throw new Error("关联远端作业身份不匹配");const task=await this.core.tasks.reconcile(t.id);if(["unknown","running","queued"].includes(task.status)){this.event(r,"recovery.wait","远端仍运行或无法确定状态");return r;}
   const recovered=this.core.toolRegistry.recoverResult(s.call?.tool??n.config.tool,r.toolPins.find(p=>p.id===n.config.tool)?.digest,t.id,{code:task.exitCode??(task.status==="succeeded"?0:1),stdout:task.logs??""});
   if(recovered.status==="succeeded"){if(n.type==="Verify")r.lastVerify=r.transitions;this.finishNode(r,n,s,{taskId:t.id,code:0,stdout:this.clean(task.logs),recovered:true,...(recovered.toolVersion?{data:recovered.data,toolVersion:recovered.toolVersion,evidence:recovered.evidence}:{})});}else{s.status="failed";s.error=recovered.error??"远端确认失败";if(n.onFailure)r.current=n.onFailure;else{r.status="failed";this.event(r,"recovery.failed",s.error);return r;}}
  }else if(s?.agentSessionId){const child=await this.agent.handle("ai.session.get",{id:s.agentSessionId}) as AgentSession;if(child.status==="unknown")await this.agent.handle("ai.session.reconcile",{id:child.id});s.status="running";r.status="awaiting_agent";r.summary="子Agent状态已核实，请在AI助手处理后继续";this.event(r,"recovery.agent",r.summary);return r;
  }else if(s?.status==="running"||s?.status==="unknown"){
   if(s.awaitingApproval&&n.type==="Tool"&&!s.taskId){s.status="running";s.awaitingApproval=false;}
   else if(["Wait","Retry","Input","Approval"].includes(n.type)){s.status="running";}
   else if(["Tool","Agent"].includes(n.type)){throw new Error("中断节点未持久化作业引用，无法证明未提交；保留现场，禁止重放");}
   else {delete r.states[n.id];}
  }
  r.pending=undefined;r.approved=undefined;r.status="paused";r.summary="检查点已核实；继续时不重放已完成节点";this.event(r,"recovery.completed",r.summary);return r;
 }
 async handle(method:string,input:unknown={}){
  if(method==="studio.workflow.run")return this.start(input);
  if(method==="studio.workflow.runs"){z.object({}).strict().parse(input);return this.core.store.list<WorkflowRun>("workflowRuns").reverse();}
  if(method==="studio.workflow.run.get")return this.get(z.object({id}).strict().parse(input).id);
  if(method==="studio.workflow.approve"){
   const p=z.object({id,digest:z.string(),approved:z.boolean()}).strict().parse(input),r=this.get(p.id);if(r.status!=="awaiting_approval"||!r.pending||r.pending.digest!==p.digest)throw new Error("审批已过期或内容不匹配");
   if(!p.approved){r.status="cancelled";r.summary="用户拒绝审批";r.pending=undefined;this.event(r,"approval.rejected",r.summary);return r;}
   const n=this.node(r,r.pending.nodeId),call=this.call(r,n);if(this.identity(r)!==r.identity||this.binding(r,n,call)!==p.digest)throw new Error("目标或操作已变化，请重新运行");r.approved=p.digest;r.pending=undefined;this.event(r,"approval.granted","已批准固定操作",{call,target:r.target});this.launch(r);return r;
  }
  if(method==="studio.workflow.input"){const p=z.object({id,values:z.record(z.string(),z.unknown())}).strict().parse(input),r=this.get(p.id);if(r.status!=="awaiting_input"||this.node(r).type!=="Input")throw new Error("当前不接受输入");const allowed=this.node(r).config.required as string[];for(const key of Object.keys(p.values))if(!allowed.includes(key)||Object.hasOwn(r.input,key))throw new Error("只能补充当前缺失字段");validateMapping(p.values);if(JSON.stringify(this.clean(p.values))!==JSON.stringify(p.values))throw new Error("输入包含凭据");Object.assign(r.input,p.values);this.event(r,"input.supplied","用户补充缺失输入",{fields:Object.keys(p.values)});this.launch(r);return r;}
  const p=z.object({id}).strict().parse(input),r=this.get(p.id);
  if(method==="studio.workflow.reconcile")return this.reconcile(r);
  if(method==="studio.workflow.resume"){if(!["paused","awaiting_agent"].includes(r.status))throw new Error("仅暂停或等待Agent流程可继续");if(Date.now()>=Date.parse(r.deadline))throw new Error("流程已超过时间上限");this.event(r,"run.resumed","用户继续流程");this.launch(r);return r;}
  if(method==="studio.workflow.pause"){const a=this.active.get(r.id);if(a){a.pause=true;this.event(r,"pause.requested","将在当前节点结束后暂停");}else if(["awaiting_input","awaiting_approval"].includes(r.status)){r.status="paused";r.pending=undefined;r.approved=undefined;this.save(r);}return r;}
  if(method==="studio.workflow.stop"){const a=this.active.get(r.id),child=r.states[r.current]?.agentSessionId;if(child)await this.agent.handle("ai.session.stop",{id:child});if(a)a.controller.abort();else{r.status=r.status==="unknown"?"unknown":"cancelled";r.pending=undefined;r.approved=undefined;this.event(r,"run.cancelled","停止后续操作，不撤销远端变更");}return r;}
  throw new Error("不支持的流程运行操作");
 }
 async close(){this.closing=true;for(const a of this.active.values())a.controller.abort();await Promise.allSettled([...this.active.values()].map(a=>a.job));}
}
