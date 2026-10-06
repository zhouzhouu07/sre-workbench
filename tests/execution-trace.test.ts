import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Backend } from "../src/main/core/backend";
import { ExecutionTraceService } from "../src/main/features/execution-trace";
const closes:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const f of closes.splice(0).reverse())await f();});
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),"sre-trace-"));closes.push(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,"trace.json"),core=new Backend({dataDir:dir,encrypt:s=>s,decrypt:s=>s,emit:()=>{},chooseFile:async()=>file});await core.init();closes.push(()=>core.close());const trace=new ExecutionTraceService(core);return {core,trace,file};}
function session(){return {id:"test",createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:10Z",status:"completed",target:{kind:"ssh",hostId:"host",root:"/",sudo:false},permission:"confirm",title:"证据记录",instruction:"检查",summary:"已完成",providerId:"model",maxSteps:10,verification:["verify"],steps:[{id:"write",createdAt:"2026-09-30T00:00:01Z",finishedAt:"2026-09-30T00:00:04Z",status:"succeeded",summary:"写入配置",call:{tool:"write_file",arguments:{path:"a.txt",content:"value"}},approval:{requestedAt:"2026-09-30T00:00:01Z",decidedAt:"2026-09-30T00:00:02Z",approved:true},output:"saved",taskId:"remote",toolVersion:"1.0.0"},{id:"verify",createdAt:"2026-09-30T00:00:06Z",finishedAt:"2026-09-30T00:00:07Z",status:"succeeded",summary:"验证",call:{tool:"verify_file",arguments:{path:"a.txt"}},output:'{"code":0}'}]};}
it("builds timestamped evidence, approval, recovery and actual model usage without inventing old versions",async()=>{
 const {core,trace}=await fixture();core.store.put("aiSessions",{...session(),modelUsageCaptured:true,recoveryEvents:[{at:"2026-09-30T00:00:05Z",status:"paused",summary:"核实完成"}],resumeEvents:[{at:"2026-09-30T00:00:06Z",summary:"继续"}]});core.store.put("modelUsage",{id:"model-call",requestId:"session-test",providerId:"model",model:"test",startedAt:"2026-09-30T00:00:00Z",finishedAt:"2026-09-30T00:00:01Z",status:"succeeded",inputTokens:10,outputTokens:5,totalTokens:15});const t=trace.get("agent","test");expect(t.metrics).toMatchObject({toolCalls:2,humanApprovals:1,humanInterventions:1,modelCalls:1,totalTokens:15,recoveryAttempts:1,resumeSuccesses:1,elapsedMs:10000});expect(t.events.map(e=>e.kind)).toEqual(expect.arrayContaining(["approval","recovery","model.call","verify.result"]));expect((t.versions as any).legacy).toBe(true);
});
it("keeps missing old usage unknown and exports redacted JSON and Markdown through native save",async()=>{
 const {core,trace,file}=await fixture();core.store.setSecret("trace-secret-test-value");const s=session();s.summary="trace-secret-test-value";core.store.put("aiSessions",{...s,agentSnapshot:{definition:{password:"hidden",name:"kept"},thinking:"hidden-thought"}});const t=trace.get("agent","test");expect(t.metrics.modelCalls).toBeNull();expect(t.metrics.totalTokens).toBeNull();await trace.handle("studio.trace.export",{source:"agent",id:"test",format:"json"});const raw=await readFile(file,"utf8");expect(raw).not.toContain("trace-secret-test-value");expect(raw).not.toContain("hidden-thought");expect(raw).not.toContain("password");expect(JSON.parse(raw).events.length).toBeGreaterThan(0);await trace.handle("studio.trace.export",{source:"agent",id:"test",format:"markdown"});expect(await readFile(file,"utf8")).toContain("## 结构化证据");
});
it("restores interrupted model requests as unknown instead of successful calls",async()=>{const {core}=await fixture();core.store.put("modelUsage",{id:"pending",status:"running"});new ExecutionTraceService(core);expect(core.store.get<any>("modelUsage","pending").status).toBe("unknown");});
it("reports measured tool durations and preserves failed and uncertain evidence states",async()=>{
 const {core,trace}=await fixture();const s=session();core.store.put("aiSessions",{...s,steps:[{...s.steps[0],startedAt:"2026-09-30T00:00:02Z",status:"failed"},{...s.steps[1],uncertain:true}]});
 const events=trace.get("agent","test").events;
 expect(events.find(e=>e.id==="write-call")).toMatchObject({tool:"write_file"});
 expect(events.find(e=>e.id==="write")).toMatchObject({tool:"write_file",status:"failed",durationMs:2000,evidenceId:"write"});
 expect(events.find(e=>e.id==="verify")).toMatchObject({tool:"verify_file",status:"unknown",evidenceId:"verify"});
 expect(events.find(e=>e.id==="verify")).not.toHaveProperty("durationMs");
});
it("uses each workflow event's recorded evidence without applying the final retry state to history",async()=>{
 const {core,trace}=await fixture();core.store.put("workflowRuns",{id:"workflow",createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:10Z",status:"completed",summary:"retry completed",target:session().target,permission:"readonly",definition:{id:"definition",name:"retry evidence",version:"1.0.0",digest:"digest",nodes:[{id:"tool",type:"Tool",config:{tool:"host_resources"}}]},states:{tool:{status:"succeeded",startedAt:"2026-09-30T00:00:08Z",finishedAt:"2026-09-30T00:00:10Z",attempts:2}},events:[{id:"legacy",nodeId:"tool",at:"2026-09-30T00:00:02Z",kind:"node.failed",summary:"旧记录缺少状态"},{id:"uncertain",nodeId:"tool",at:"2026-09-30T00:00:04Z",kind:"node.failed",summary:"等待核实",data:{status:"unknown",startedAt:"2026-09-30T00:00:03Z",finishedAt:"2026-09-30T00:00:04Z",call:{tool:"host_resources",arguments:{scope:"actual"}},output:{code:15}}}]});
 const events=trace.get("workflow","workflow").events;
 expect(events.find(e=>e.id==="legacy")).not.toHaveProperty("status");
 expect(events.find(e=>e.id==="legacy")).not.toHaveProperty("durationMs");
 expect(events.find(e=>e.id==="uncertain")).toMatchObject({tool:"host_resources",status:"unknown",durationMs:1000,data:{data:{call:{arguments:{scope:"actual"}},output:{code:15}}}});
});
