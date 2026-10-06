import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Backend } from "../src/main/core/backend";
import { AIService } from "../src/main/features/ai";
import { AgentService } from "../src/main/features/agent";
import { WorkflowRuntime } from "../src/main/features/workflow-runtime";
import { condition, resolveMapping } from "../src/main/features/workflow-contract";
import { AgentTools, UncertainExecution } from "../src/main/features/agent-tools";
import type { WorkflowNode, WorkflowRun } from "../src/shared/workflow";
const closes:(()=>Promise<unknown>)[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const close of closes.splice(0).reverse())await close();});
const n=(id:string,type:WorkflowNode["type"],config:any={},next?:string,extra:Partial<WorkflowNode>={}):WorkflowNode=>({id,type,label:id,x:0,y:0,config,next,...extra});
const target={kind:"ssh" as const,hostId:"host",root:"/opt/test",sudo:false};
it("restarts implicit tool approval without executing or losing the ability to request a fresh approval",async()=>{
 const {runtime,start,core,agent}=await fixture();const exec=vi.spyOn(AgentTools.prototype,"execute").mockResolvedValue({code:0,stdout:"ok"});
 const r=await start([n("start","Start",{},"tool"),n("tool","Tool",{tool:"service_action",arguments:{unit:"demo.service",action:"start"}},"verify"),n("verify","Verify",{tool:"verify_service",arguments:{unit:"demo.service"}},"end"),n("end","End")],"confirm");const pending=await until(runtime,r.id,["awaiting_approval"]);const restored=new WorkflowRuntime(core,agent,()=>{});
 await restored.handle("studio.workflow.reconcile",{id:r.id});await restored.handle("studio.workflow.resume",{id:r.id});const again=await until(restored,r.id,["awaiting_approval"]);expect(again.pending?.call).toEqual(pending.pending?.call);expect(exec).not.toHaveBeenCalled();await restored.close();
});
it("retains imported tool structured data on recovery for downstream condition mappings",async()=>{
 const {runtime,start,core,agent}=await fixture();const p=await core.toolRegistry.previewPackage(path.resolve("examples/tool-packages/uptime"));core.toolRegistry.install(p.token);core.toolRegistry.enable("custom.uptime",true);
 const exec=vi.spyOn(core.toolRegistry,"execute").mockImplementation(async(...args)=>{if(args[2].tool==="custom.uptime"){core.store.put("tasks",{id:"custom-job",hostId:"host",source:"ai",status:"unknown",logs:""});args[5]("custom-job");throw new UncertainExecution("disconnected");}return {code:0,stdout:"verified"};});
 const r=await start([n("start","Start",{},"custom"),n("custom","Tool",{tool:"custom.uptime",arguments:{}},"output"),n("output","Output",{value:{$ref:"outputs.custom.data.uptimeSeconds"}},"verify"),n("verify","Verify",{tool:"verify_file",arguments:{path:"result.json"}},"end"),n("end","End")]);const pending=await until(runtime,r.id,["awaiting_approval"]);await runtime.handle("studio.workflow.approve",{id:r.id,digest:pending.pending!.digest,approved:true});await until(runtime,r.id,["unknown"]);
 vi.spyOn(core.tasks,"reconcile").mockResolvedValue({id:"custom-job",status:"succeeded",exitCode:0,logs:'{"uptimeSeconds":42}'} as any);const restored=new WorkflowRuntime(core,agent,()=>{});await restored.handle("studio.workflow.reconcile",{id:r.id});await restored.handle("studio.workflow.resume",{id:r.id});const done=await until(restored,r.id,["completed","failed"]);expect(done.status).toBe("completed");expect(done.outputs.output).toBe(42);expect(exec.mock.calls.filter(c=>c[2].tool==="custom.uptime")).toHaveLength(1);await restored.close();
});
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),"sre-flow-"));closes.push(()=>rm(dir,{recursive:true,force:true}));const core=new Backend({dataDir:dir,encrypt:s=>s,decrypt:s=>s,emit:()=>{},chooseFile:async()=>null});await core.init();core.store.put("hosts",{id:"host",name:"test",address:"192.0.2.10",port:22,username:"root",fingerprint:"test",credentialId:"",authType:"password",group:"",tags:[]});core.store.put("providers",{id:"model",kind:"model",protocol:"openai",name:"test",model:"test",baseUrl:"http://127.0.0.1:1234/v1",timeout:10});const ai=new AIService(core.store,()=>{}),agent=new AgentService(core,ai,()=>{}),runtime=new WorkflowRuntime(core,agent,()=>{});closes.push(async()=>{await runtime.close();await agent.close();ai.close();await core.close();});const save=(nodes:WorkflowNode[])=>core.workflowRegistry.save({name:"测试",description:"",nodes});const start=async(nodes:WorkflowNode[],permission="autonomous",input:any={})=>runtime.handle("studio.workflow.run",{id:save(nodes).id,target,permission,input}) as Promise<WorkflowRun>;return {core,ai,agent,runtime,save,start};}
async function until(runtime:WorkflowRuntime,id:string,status:string[]){for(let i=0;i<300;i++){const r=runtime.get(id);if(status.includes(r.status)){await new Promise(r=>setTimeout(r,2));return r;}await new Promise(r=>setTimeout(r,5));}throw new Error("流程未达到预期状态："+JSON.stringify(runtime.get(id)));}
it("does not persist an orphan run when concurrent starts race after target validation",async()=>{
 const {start,core}=await fixture();
 const graph=[n("start","Start",{},"wait"),n("wait","Wait",{seconds:5},"end"),n("end","End")];
 const results=await Promise.allSettled([start(graph),start(graph)]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 expect(core.store.list("workflowRuns")).toHaveLength(1);
});
it("does not save a running checkpoint when shutdown wins target validation",async()=>{
 const {runtime,start,core}=await fixture();
 let validated!:(value:typeof target)=>void;
 vi.spyOn(core.toolRegistry,"validateTarget").mockImplementation(()=>new Promise(resolve=>{validated=resolve;}));
 const pending=start([n("start","Start",{},"end"),n("end","End")]);
 const rejected=expect(pending).rejects.toThrow(/退出/);
 await runtime.close();validated(target);await rejected;
 expect(core.store.list("workflowRuns")).toHaveLength(0);
});
it.each(["failed","cancelled"])("accounts %s child tools before an onFailure successor can exceed the parent budget",async status=>{
 const {runtime,start,core,agent}=await fixture();const a=core.agentBuilder.get("template.inspection"),{id,version,source,createdAt,updatedAt,digest,...config}=a;core.agentBuilder.save({...config,id,expectedDigest:digest,providerId:"model"});
 const launches:number[]=[];vi.spyOn(agent,"startPrepared").mockImplementation(async(params:any,_snapshot:any,sessionId?:string)=>{launches.push(params.maxSteps);return {id:sessionId} as any;});
 const original=agent.handle.bind(agent);vi.spyOn(agent,"handle").mockImplementation(async(method,input:any)=>method==="ai.session.get"?{id:input.id,status,summary:"failed after tools",steps:Array.from({length:10},()=>({status:"failed",call:{tool:"run_command",arguments:{command:"false"}}}))}:original(method,input));
 const r=await start([n("start","Start",{},"input"),n("input","Input",{required:["ready"]},"first"),n("first","Agent",{agentId:id,instruction:"first"},"end",{onFailure:"second"}),n("second","Agent",{agentId:id,instruction:"second"},"end"),n("end","End")]);await until(runtime,r.id,["awaiting_input"]);
 const pending=runtime.get(r.id);pending.parentAgent=structuredClone(pending.agents.first.snapshot);pending.parentAgent.definition.maxSteps=10;core.store.put("workflowRuns",pending);
 await runtime.handle("studio.workflow.input",{id:r.id,values:{ready:true}});const done=await until(runtime,r.id,["failed"]);
 expect(launches).toHaveLength(1);expect(done.toolCalls).toBe(10);expect(done.lastMutation).toBeGreaterThanOrEqual(0);expect(done.summary).toContain("总上限");
});
it("does not account a completed child's tools again after restoring the accounting checkpoint",async()=>{
 const {runtime,start,core,agent}=await fixture();const a=core.agentBuilder.get("template.inspection"),{id,version,source,createdAt,updatedAt,digest,...config}=a;core.agentBuilder.save({...config,id,expectedDigest:digest,providerId:"model"});
 vi.spyOn(agent,"startPrepared").mockResolvedValue({id:"child"} as any);const original=agent.handle.bind(agent);vi.spyOn(agent,"handle").mockImplementation(async(method,input:any)=>method==="ai.session.get"?{id:input.id,status:"completed",summary:"done",verification:[],steps:Array.from({length:3},()=>({status:"succeeded",call:{tool:"host_resources",arguments:{}}}))}:original(method,input));
 let checkpoint:WorkflowRun|undefined;const put=core.store.put.bind(core.store);vi.spyOn(core.store,"put").mockImplementation((collection:any,value:any)=>{if(collection==="workflowRuns"&&value.states?.child?.status==="running"&&value.states.child.agentToolsAccounted)checkpoint=structuredClone(value);return put(collection,value);});
 const r=await start([n("start","Start",{},"child"),n("child","Agent",{agentId:id,instruction:"test"},"input"),n("input","Input",{required:["ready"]},"end"),n("end","End")]);await until(runtime,r.id,["awaiting_input"]);expect(checkpoint).toBeDefined();
 core.store.put("workflowRuns",checkpoint!);const restored=new WorkflowRuntime(core,agent,()=>{});await restored.handle("studio.workflow.reconcile",{id:r.id});await restored.handle("studio.workflow.resume",{id:r.id});await until(restored,r.id,["awaiting_input"]);expect(restored.get(r.id).toolCalls).toBe(3);await restored.close();
});
it("validates both built-in workflow templates and rejects dangling nodes, cycles and invalid retry",async()=>{
 const {core,save}=await fixture();for(const t of core.workflowRegistry.list())expect(()=>core.workflowRegistry.validate({name:t.name,description:t.description,nodes:t.nodes})).not.toThrow();
 expect(()=>save([n("start","Start",{},"missing"),n("end","End")])).toThrow(/悬空/);
 expect(()=>save([n("start","Start",{},"loop"),n("loop","Wait",{seconds:0},"loop"),n("end","End")])).toThrow(/循环/);
 expect(()=>save([n("start","Start",{},"end"),n("other","Wait",{seconds:0},"end"),n("end","End")])).toThrow(/不可达/);
 expect(()=>save([n("start","Start",{},"retry"),n("retry","Retry",{retryTarget:"start",maxRetries:4,backoff:0},"end"),n("end","End")])).toThrow();
 expect(()=>save([n("start","Start",{},"output"),n("output","Output",{value:{$ref:"outputs.missing.value"}},"end"),n("end","End")])).toThrow(/不存在/);
});
it("evaluates bounded structured conditions and rejects executable expressions and prototype paths",()=>{
 expect(condition({left:{$ref:"input.status"},op:"gte",right:200},{input:{status:204},outputs:{}})).toBe(true);
 expect(condition({left:{$ref:"input.missing"},op:"exists"},{input:{},outputs:{}})).toBe(false);
 expect(()=>condition({left:"200",op:"gt",right:100},{input:{},outputs:{}})).toThrow(/数值/);
 expect(()=>condition({left:1,op:"eval",right:"process.exit()"},{input:{},outputs:{}})).toThrow();
 expect(()=>resolveMapping({$ref:"input.constructor"},{input:{},outputs:{}})).toThrow(/引用/);
});
it("persists Input, Skill, Wait, Condition and Output nodes with missing input resumed safely",async()=>{
 const {runtime,start}=await fixture();const r=await start([n("start","Start",{},"input"),n("input","Input",{required:["ready"]},"skill"),n("skill","Skill",{skillId:"linux-inspection"},"wait"),n("wait","Wait",{seconds:0},"condition"),n("condition","Condition",{left:{$ref:"input.ready"},op:"eq",right:true},"output",{otherwise:"end"}),n("output","Output",{value:{$ref:"input.ready"}},"end"),n("end","End")]);
 await until(runtime,r.id,["awaiting_input"]);await runtime.handle("studio.workflow.input",{id:r.id,values:{ready:true}});const done=await until(runtime,r.id,["completed"]);expect(done.outputs.output).toBe(true);expect(done.activeSkills).toEqual(["linux-inspection"]);expect(done.states.wait.dueAt).toBeTruthy();
});
it("binds approval to exact target and arguments and requires independent Verify",async()=>{
 const {runtime,start}=await fixture();const exec=vi.spyOn(AgentTools.prototype,"execute").mockResolvedValue({code:0,stdout:"ok"});
 const r=await start([n("start","Start",{},"approval"),n("approval","Approval",{toolNodeId:"repair"},"repair"),n("repair","Tool",{tool:"service_action",arguments:{unit:"demo.service",action:"start"}},"verify"),n("verify","Verify",{tool:"verify_service",arguments:{unit:"demo.service"}},"end"),n("end","End")]);
 const awaiting=await until(runtime,r.id,["awaiting_approval"]);expect(exec).not.toHaveBeenCalled();await expect(runtime.handle("studio.workflow.approve",{id:r.id,digest:"forged",approved:true})).rejects.toThrow(/不匹配/);
 await runtime.handle("studio.workflow.approve",{id:r.id,digest:awaiting.pending!.digest,approved:true});const done=await until(runtime,r.id,["completed"]);expect(exec.mock.calls.map(c=>c[2].tool)).toEqual(["service_action","verify_service"]);expect(exec.mock.calls[0][3]).toBe(true);expect(done.lastVerify).toBeGreaterThan(done.lastMutation);
});
it("does not allow readonly or missing post-change verification to succeed",async()=>{
 const {runtime,start}=await fixture();const exec=vi.spyOn(AgentTools.prototype,"execute").mockResolvedValue({code:0,stdout:"ok"});const graph=[n("start","Start",{},"repair"),n("repair","Tool",{tool:"service_action",arguments:{unit:"demo.service",action:"start"}},"end"),n("end","End")];
 const denied=await start(graph,"readonly");await until(runtime,denied.id,["failed"]);expect(exec).not.toHaveBeenCalled();const unverified=await start(graph);const done=await until(runtime,unverified.id,["failed"]);expect(done.summary).toContain("Verify");expect(exec).toHaveBeenCalledTimes(1);
});
it("retries only a confirmed failed node within a bounded retry counter",async()=>{
 const {runtime,start}=await fixture();const exec=vi.spyOn(AgentTools.prototype,"execute").mockResolvedValueOnce({code:1,stdout:"temporary"}).mockResolvedValue({code:0,stdout:"ready"});
 const r=await start([n("start","Start",{},"verify"),n("verify","Verify",{tool:"http_check",arguments:{url:"http://127.0.0.1:18101"}},"end",{onFailure:"retry"}),n("retry","Retry",{retryTarget:"verify",maxRetries:2,backoff:0},"end"),n("end","End")]);const done=await until(runtime,r.id,["completed"]);expect(done.retries.retry).toBe(1);expect(exec).toHaveBeenCalledTimes(2);expect(done.events.find(e=>e.kind==="node.failed")?.data).toMatchObject({status:"failed",call:{tool:"http_check",arguments:{url:"http://127.0.0.1:18101"}},output:{code:1,stdout:"temporary"}});expect(done.events.find(e=>e.kind==="node.completed"&&e.nodeId==="verify")?.data).toMatchObject({status:"succeeded",output:{code:0,stdout:"ready"}});
});
it("recovers submitted tasks after restart without replaying either completed mutation",async()=>{
 const {runtime,start,core,agent}=await fixture();let calls=0;const exec=vi.spyOn(AgentTools.prototype,"execute").mockImplementation(async(...args)=>{calls++;if(calls===2){core.store.put("tasks",{id:"remote",hostId:"host",source:"ai",status:"unknown",logs:"",updatedAt:new Date().toISOString()});args[5]("remote");throw new UncertainExecution("SSH断线");}return {code:0,stdout:"ok"};});
 const r=await start([n("start","Start",{},"first"),n("first","Tool",{tool:"service_action",arguments:{unit:"a.service",action:"start"}},"second"),n("second","Tool",{tool:"service_action",arguments:{unit:"b.service",action:"start"}},"verify"),n("verify","Verify",{tool:"verify_service",arguments:{unit:"b.service"}},"end"),n("end","End")]);await until(runtime,r.id,["unknown"]);
 const restored=new WorkflowRuntime(core,agent,()=>{});vi.spyOn(core.tasks,"reconcile").mockResolvedValue({...core.store.get<any>("tasks","remote"),status:"succeeded",exitCode:0,logs:"done"});await restored.handle("studio.workflow.reconcile",{id:r.id});expect(restored.get(r.id).status).toBe("paused");await restored.handle("studio.workflow.resume",{id:r.id});await until(restored,r.id,["completed"]);expect(exec.mock.calls.map(c=>c[2].tool)).toEqual(["service_action","service_action","verify_service"]);await restored.close();
});
it("invalidates pending approvals on restart and refuses uncertain operations without a task reference",async()=>{
 const {runtime,start,core,agent}=await fixture();vi.spyOn(AgentTools.prototype,"execute").mockRejectedValue(new UncertainExecution("unknown"));const r=await start([n("start","Start",{},"tool"),n("tool","Tool",{tool:"service_action",arguments:{unit:"a.service",action:"start"}},"end"),n("end","End")]);await until(runtime,r.id,["unknown"]);await expect(runtime.handle("studio.workflow.reconcile",{id:r.id})).rejects.toThrow(/禁止重放/);
});
it("runs Agent nodes through the existing runtime and persists the child id before waiting",async()=>{
 const {runtime,start,core,ai}=await fixture();const a=core.agentBuilder.get("template.inspection");const {id,version,source,createdAt,updatedAt,digest,...config}=a;core.agentBuilder.save({...config,id,expectedDigest:digest,providerId:"model"});vi.spyOn(ai,"agentStep").mockResolvedValue({type:"question",summary:"请提供巡检范围"});
 const r=await start([n("start","Start",{},"agent"),n("agent","Agent",{agentId:id,instruction:"巡检"},"end"),n("end","End")]);const done=await until(runtime,r.id,["awaiting_agent"]);expect(done.states.agent.agentSessionId).toBeTruthy();expect(core.store.get<any>("aiSessions",done.states.agent.agentSessionId!).agentSnapshot.workflow.id).toBe(done.definition.id);
 await runtime.handle("studio.workflow.stop",{id:r.id});expect(core.store.get<any>("aiSessions",done.states.agent.agentSessionId!).status).toBe("cancelled");
});
it("freezes a workflow child model identity before reaching its Agent node",async()=>{
 const {runtime,start,core,ai}=await fixture();const a=core.agentBuilder.get("template.inspection");const {id,version,source,createdAt,updatedAt,digest,...config}=a;core.agentBuilder.save({...config,id,expectedDigest:digest,providerId:"model"});const model=vi.spyOn(ai,"agentStep");
 const r=await start([n("start","Start",{},"input"),n("input","Input",{required:["ready"]},"agent"),n("agent","Agent",{agentId:id,instruction:"巡检"},"end"),n("end","End")]);await until(runtime,r.id,["awaiting_input"]);core.store.put("providers",{...core.store.get<any>("providers","model"),model:"changed"});await runtime.handle("studio.workflow.input",{id:r.id,values:{ready:true}});const failed=await until(runtime,r.id,["failed"]);expect(failed.summary).toContain("快照后变化");expect(model).not.toHaveBeenCalled();
});
it("expires approval across app restart and asks again before autonomous execution",async()=>{
 const {runtime,start,core,agent}=await fixture();const exec=vi.spyOn(AgentTools.prototype,"execute").mockResolvedValue({code:0,stdout:"ok"});const r=await start([n("start","Start",{},"approval"),n("approval","Approval",{toolNodeId:"tool"},"tool"),n("tool","Tool",{tool:"service_action",arguments:{unit:"demo.service",action:"start"}},"verify"),n("verify","Verify",{tool:"verify_service",arguments:{unit:"demo.service"}},"end"),n("end","End")]);const pending=await until(runtime,r.id,["awaiting_approval"]);const restored=new WorkflowRuntime(core,agent,()=>{});await expect(restored.handle("studio.workflow.approve",{id:r.id,digest:pending.pending!.digest,approved:true})).rejects.toThrow(/过期/);await restored.handle("studio.workflow.reconcile",{id:r.id});await restored.handle("studio.workflow.resume",{id:r.id});await until(restored,r.id,["awaiting_approval"]);expect(exec).not.toHaveBeenCalled();await restored.close();
});
it("ends bounded retries after confirmed repeated failures",async()=>{
 const {runtime,start}=await fixture();const exec=vi.spyOn(AgentTools.prototype,"execute").mockResolvedValue({code:1,stdout:"still broken"});const r=await start([n("start","Start",{},"verify"),n("verify","Verify",{tool:"http_check",arguments:{url:"http://127.0.0.1:18101"}},"end",{onFailure:"retry"}),n("retry","Retry",{retryTarget:"verify",maxRetries:2,backoff:0},"end"),n("end","End")]);const failed=await until(runtime,r.id,["failed"]);expect(failed.summary).toContain("重试上限");expect(exec).toHaveBeenCalledTimes(3);
});
