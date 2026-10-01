import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Backend } from "../src/main/core/backend";
const closes:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const c of closes.splice(0).reverse())await c();});
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),"sre-builder-"));closes.push(()=>rm(dir,{recursive:true,force:true}));const core=new Backend({dataDir:dir,encrypt:s=>s,decrypt:s=>s,emit:()=>{},chooseFile:async()=>path.join(dir,"agent.json")});await core.init();closes.push(()=>core.close());core.store.put("providers",{id:"model",kind:"model",protocol:"openai",baseUrl:"http://127.0.0.1:1234/v1",name:"test",model:"model"});core.store.put("hosts",{id:"host",fingerprint:"test",name:"test"});const a=core.agentBuilder.clone("template.inspection");const {id,version,source,createdAt,updatedAt,digest,...config}=a;const saved=core.agentBuilder.save({...config,id,expectedDigest:digest,providerId:"model",enabled:true,targetHostIds:["host"],rootPrefix:"/opt/test"});return {core,r:core.agentBuilder,a:saved};}
const run=(id:string)=>({id,target:{kind:"ssh",hostId:"host",root:"/opt/test",sudo:false},permission:"readonly",instruction:"巡检环境"});
function editable(a:any){const {id,version,source,createdAt,updatedAt,digest,...config}=a;return {...config,id,expectedDigest:digest};}
it("provides definition templates and immutable versioned runtime snapshots",async()=>{
 const {r,a}=await fixture();expect(r.list().filter(a=>a.source==="template")).toHaveLength(4);const prepared=r.prepare(run(a.id));
 const edited=r.save({...editable(a),name:"新的定义",toolIds:[]});expect(edited.version).not.toBe(a.version);expect(prepared.snapshot.definition.name).toBe(a.name);expect(prepared.snapshot.tools.length).toBeGreaterThan(0);
 r.remove(a.id);expect(prepared.snapshot.skills[0].skillVersion).toBe("1.0.1");expect(()=>r.save(editable(a))).toThrow();
});
it("checks exact targets, permissions, tools and model references before starting",async()=>{
 const {r,a,core}=await fixture();expect(()=>r.prepare({...run(a.id),permission:"autonomous"})).toThrow(/上限/);
 expect(()=>r.prepare({...run(a.id),target:{kind:"local",root:"C:/temp"}})).toThrow(/SSH/);
 expect(()=>r.prepare({...run(a.id),target:{kind:"ssh",hostId:"host",root:"/opt/test-other",sudo:false}})).toThrow(/目录/);
 core.store.put("hosts",{id:"other",fingerprint:"test"});expect(()=>r.prepare({...run(a.id),target:{kind:"ssh",hostId:"other",root:"/opt/test",sudo:false}})).toThrow(/范围/);
 core.toolRegistry.disable("host_resources");expect(()=>r.prepare(run(a.id))).toThrow(/禁用/);
 expect(()=>r.save({...editable(a),providerId:"missing"})).toThrow(/模型/);
});
it("checks skill whitelist, rejects stale saves and preserves private configuration boundaries",async()=>{
 const {r,a,core}=await fixture();const updated=r.save({...editable(a),toolIds:["host_resources"]});expect(()=>r.prepare(run(a.id))).toThrow(/白名单/);
 expect(()=>r.save(editable(a))).toThrow(/变化/);core.store.setSecret("agent-secret-test");expect(()=>r.save({...editable(updated),description:"agent-secret-test"})).toThrow(/凭据/);
 expect(()=>r.save({...editable(updated),apiKey:"illegal"})).toThrow();
});
it("exports and imports a disabled new identity and retains a usable model reference",async()=>{
 const {r,a}=await fixture();await r.handle("studio.agent.export",{id:a.id});const imported:any=await r.handle("studio.agent.import",{});expect(imported.id).not.toBe(a.id);expect(imported.enabled).toBe(false);expect(imported.providerId).toBe("model");
 expect(()=>r.prepare(run(imported.id))).toThrow(/禁用/);expect(()=>r.remove("template.inspection")).toThrow(/模板/);
});
