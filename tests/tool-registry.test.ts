import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, cp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Backend } from "../src/main/core/backend";
import { AgentTools } from "../src/main/features/agent-tools";
import { toolSchemas } from "../src/main/features/agent-contract";
import { validateSchema, validateValue } from "../src/main/features/studio-schema";
const cleanups: (()=>Promise<unknown>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const f of cleanups.splice(0).reverse())await f();});
async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),"sre-tools-"));
 cleanups.push(()=>rm(dir,{recursive:true,force:true}));
 const core=new Backend({dataDir:path.join(dir,"data"),encrypt:s=>s,decrypt:s=>s,emit:()=>{},chooseFile:async()=>path.join(dir,"package")});
 await core.init();cleanups.push(()=>core.close());
 await cp(path.resolve("examples/tool-packages/uptime"),path.join(dir,"package"),{recursive:true});
 return {core,r:core.toolRegistry,dir,pkg:path.join(dir,"package")};
}
const target={kind:"ssh" as const,hostId:"test",root:"/opt/test",sudo:false};
it("preserves every builtin contract and persisted enable overrides",async()=>{
 const {r,core}=await fixture();expect(r.list().map(t=>t.id)).toEqual(Object.keys(toolSchemas));
 expect(r.validate({tool:"read_file",arguments:{path:"a.txt"}}).tool).toBe("read_file");
 expect(()=>r.validate({tool:"read_file",arguments:{path:"a",extra:true}})).toThrow();
 r.disable("read_file");expect(()=>r.validate({tool:"read_file",arguments:{path:"a"}})).toThrow(/禁用/);
 expect(core.store.get<any>("tools","read_file").enabled).toBe(false);
 expect(()=>r.unregister("read_file")).toThrow(/内置/);
 expect(()=>r.get("__proto__")).toThrow(/不存在/);
});
it("imports cached reviewed content, defaults disabled, and rejects duplicates and forged IPC",async()=>{
 const {r,pkg}=await fixture();const p=await r.previewPackage(pkg);
 await writeFile(path.join(pkg,"run.sh"),"changed after review");
 const t=r.install(p.token);expect(t.enabled).toBe(false);expect(t.baseRisk).toBe(60);
 expect(t.verificationCapability).toBe(false);expect((t as any).script).toBeUndefined();
 expect(()=>r.install(p.token)).toThrow(/失效/);
 await expect(r.previewPackage(pkg)).rejects.toThrow(/Duplicate/);
 await expect(r.handle("studio.tool.preview",{directory:pkg})).rejects.toThrow();
 r.enable(t.id,true);const pin=r.version(t.id);
 expect(()=>r.validate({tool:t.id,arguments:{}},{...pin,digest:"changed"})).toThrow(/版本/);
 r.unregister(t.id);expect(()=>r.validate({tool:t.id,arguments:{}},pin)).toThrow(/不存在/);
});
it("enforces approval and pinned executor while forwarding timeout, task id and output schema",async()=>{
 const {r,pkg}=await fixture();const t=r.install((await r.previewPackage(pkg)).token);r.enable(t.id,true);
 const exec=vi.spyOn(AgentTools.prototype,"execute").mockImplementation(async(...args)=>{args[5]("remote-1");return {code:0,stdout:'{"uptimeSeconds":123}'};});
 const c={tool:t.id,arguments:{}},pin=r.version(t.id),signal=new AbortController().signal;
 for(const p of ["advice","readonly"] as const)await expect(r.execute(target,p,c,true,signal,()=>{},pin)).rejects.toThrow(/拒绝/);
 await expect(r.execute(target,"autonomous",c,false,signal,()=>{},pin)).rejects.toThrow(/拒绝/);
 await expect(r.execute(target,"autonomous",c,true,signal,()=>{})).rejects.toThrow(/快照/);
 expect(exec).not.toHaveBeenCalled();
 const callback=vi.fn();const result:any=await r.execute(target,"autonomous",c,true,signal,callback,pin);
 expect(result.data).toEqual({uptimeSeconds:123});expect(callback).toHaveBeenCalledWith("remote-1");
 expect(exec.mock.calls[0][2].arguments.timeout).toBe(30);
 expect(String(exec.mock.calls[0][2].arguments.command)).toContain("SRE_TOOL_INPUT");
 expect(r.usage(t.id)[0]).toMatchObject({status:"succeeded",taskId:"remote-1",digest:pin.digest});
 exec.mockResolvedValue({code:0,stdout:'{"uptimeSeconds":"bad"}'});
 await expect(r.execute(target,"confirm",c,true,signal,()=>{},pin)).rejects.toThrow(/输出/);
 expect(r.usage(t.id)[0].status).toBe("failed");
});
it.each(["../outside.sh","/etc/passwd","nested\\run.sh"])("rejects escaping package script %s",async script=>{
 const {r,pkg}=await fixture();const file=path.join(pkg,"manifest.json");const m=JSON.parse(await readFile(file,"utf8"));m.script=script;await writeFile(file,JSON.stringify(m));
 await expect(r.previewPackage(pkg)).rejects.toThrow(/路径/);
});
it("rejects excessive package files and unsupported schemas",async()=>{
 const {r,pkg}=await fixture();await writeFile(path.join(pkg,"run.sh"),"x".repeat(90001));await expect(r.previewPackage(pkg)).rejects.toThrow(/限额/);
 expect(()=>validateSchema({type:"string",pattern:".*"})).toThrow();
 expect(()=>validateSchema({type:"object",properties:{},additionalProperties:true})).toThrow();
 expect(()=>validateSchema({type:"string",minLength:3,maxLength:1})).toThrow();
 expect(()=>validateSchema({type:"number",minLength:3})).toThrow();
 expect(()=>validateSchema({type:"string",enum:[1]})).toThrow();
 expect(()=>validateSchema({type:"object",properties:{},additionalProperties:false,required:["missing"]})).toThrow();
 const schema={type:"array",items:{type:"integer",minimum:0},maxItems:2};validateSchema(schema);
 expect(()=>validateValue(schema,[1,2])).not.toThrow();expect(()=>validateValue(schema,[1,-1])).toThrow();expect(()=>validateValue(schema,[1,2,3])).toThrow();
});
it("redacts results and refuses to turn invalid recovered output into success",async()=>{
 const {core,r,pkg}=await fixture();const t=r.install((await r.previewPackage(pkg)).token);r.enable(t.id,true);
 core.store.setSecret("tool-test-secret-value");
 vi.spyOn(AgentTools.prototype,"execute").mockImplementation(async(...args)=>{args[5]("task-redact");return {code:0,stdout:'{"uptimeSeconds":10}',stderr:"tool-test-secret-value"};});
 const result=await r.execute(target,"confirm",{tool:t.id,arguments:{}},true,new AbortController().signal,()=>{},r.version(t.id));
 expect(JSON.stringify(result)).not.toContain("tool-test-secret-value");
 expect(r.recoverResult(t.id,t.digest,"task-redact",{code:0,stdout:'{"bad":true}'}).status).toBe("failed");
 expect(r.usage(t.id)[0].status).toBe("failed");
 r.unregister(t.id);expect(r.recoverResult(t.id,t.digest,"task-redact",{code:0,stdout:'{"uptimeSeconds":10}'}).status).toBe("failed");
});
it.each(["https://127.0.0.1/health","http://example.com/health","http://127.0.0.1/health?token=x"])("rejects HTTP endpoint %s",async url=>{
 const {r,pkg}=await fixture();const file=path.join(pkg,"manifest.json");const m=JSON.parse(await readFile(file,"utf8"));delete m.script;m.type="http";m.url=url;await writeFile(file,JSON.stringify(m));
 await expect(r.previewPackage(pkg)).rejects.toThrow();
});
it("restores running usage as unknown and never executes during restart",async()=>{
 const {core,r}=await fixture();core.store.put("toolUsage",{id:"interrupted",status:"running",toolId:"run_command"});
 const spy=vi.spyOn(AgentTools.prototype,"execute");r.init();expect(r.usage()[0].status).toBe("unknown");expect(spy).not.toHaveBeenCalled();
});
it("redacts synthetic credentials in recovered structured data as in normal execution",async()=>{
 const {core,r,pkg}=await fixture(),file=path.join(pkg,"manifest.json"),m=JSON.parse(await readFile(file,"utf8"));
 m.outputSchema={type:"object",properties:{message:{type:"string"}},required:["message"],additionalProperties:false};await writeFile(file,JSON.stringify(m));const t=r.install((await r.previewPackage(pkg)).token);r.enable(t.id,true);
 const synthetic="Bearer REVIEW_SYNTHETIC_TOKEN",raw=JSON.stringify({message:synthetic});
 const recovered=r.recoverResult(t.id,t.digest,"synthetic-task",{code:0,stdout:raw});
 expect(recovered.status).toBe("succeeded");expect(JSON.stringify(recovered)).not.toContain("REVIEW_SYNTHETIC_TOKEN");
 vi.spyOn(AgentTools.prototype,"execute").mockResolvedValue({code:0,stdout:raw});const normal:any=await r.execute(target,"confirm",{tool:t.id,arguments:{}},true,new AbortController().signal,()=>{},r.version(t.id));
 expect(recovered.data).toEqual(normal.data);
});
