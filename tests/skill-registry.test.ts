import { afterEach, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Backend } from "../src/main/core/backend";
const cleanups:(()=>Promise<unknown>)[]=[];
it("installs bundled healing skill with the separately reviewed health tool dependency",async()=>{
 const {core,r}=await fixture();const tool=await core.toolRegistry.previewPackage(path.resolve("examples/tool-packages/web-health"));core.toolRegistry.install(tool.token);expect(core.toolRegistry.get(tool.definition.id).permissionRequirement).toBe("mutation");core.toolRegistry.enable(tool.definition.id,true);const skill=await r.previewPackage(path.resolve("examples/skill-packages/web-healing"));r.install(skill.token);expect(r.get(skill.definition.id).enabled).toBe(false);r.enable(skill.definition.id,true);const snapshot=r.snapshot([skill.definition.id])[0];expect(snapshot.toolDependencies.map(t=>t.id)).toContain("custom.web-health");expect(snapshot.instructionsSnapshot).toContain("先核实原Task");
});
afterEach(async()=>{for(const f of cleanups.splice(0).reverse())await f();});
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),"sre-skills-"));cleanups.push(()=>rm(dir,{recursive:true,force:true}));const core=new Backend({dataDir:path.join(dir,"data"),encrypt:s=>s,decrypt:s=>s,emit:()=>{},chooseFile:async()=>null});await core.init();cleanups.push(()=>core.close());const pkg=path.join(dir,"package");await cp(path.resolve("examples/skill-packages/web-diagnosis"),pkg,{recursive:true});return {core,r:core.skillRegistry,pkg};}
async function update(pkg:string,change:(m:any)=>void){const f=path.join(pkg,"manifest.json"),m=JSON.parse(await readFile(f,"utf8"));change(m);await writeFile(f,JSON.stringify(m));}
it("migrates builtin skills with immutable structured snapshots and dependency checks",async()=>{
 const {r,core}=await fixture();expect(r.list()).toHaveLength(4);
 const snapshot=r.select("auto","帮我巡检服务器");expect(snapshot[0]).toMatchObject({id:"linux-inspection",skillVersion:"1.0.1"});expect(snapshot[0].toolDependencies.length).toBeGreaterThan(0);
 r.enable("linux-inspection",false);expect(r.select("auto","巡检服务器")).toEqual([]);expect(snapshot[0].instructionsSnapshot).toContain("只读");
 expect(()=>r.snapshot(["linux-inspection"])).toThrow(/禁用/);
 r.enable("linux-inspection",true);core.toolRegistry.disable("host_resources");expect(()=>r.snapshot(["linux-inspection"])).toThrow(/缺少Tool/);
 expect(r.list().find(s=>s.id==="linux-inspection")?.missingTools).toContain("host_resources");
 expect(()=>r.remove("linux-inspection")).toThrow(/内置/);
});
it("installs, upgrades and deletes without mutating historical snapshots",async()=>{
 const {r,pkg}=await fixture();const preview=await r.previewPackage(pkg);const t=r.install(preview.token);expect(t.enabled).toBe(false);r.enable(t.id,true);
 const snapshot=r.snapshot([t.id]);await update(pkg,m=>m.version="1.1.0");await writeFile(path.join(pkg,"instructions.md"),"新的诊断方法");
 const upgrade=await r.previewPackage(pkg);expect(upgrade.upgrade).toBe(true);r.install(upgrade.token);expect(r.get(t.id).enabled).toBe(false);
 expect(snapshot[0].skillVersion).toBe("1.0.0");expect(snapshot[0].instructions).not.toBe("新的诊断方法");expect(snapshot[0].acceptanceSnapshot.length).toBe(2);
 r.remove(t.id);expect(snapshot[0].toolDependencies.length).toBeGreaterThan(0);expect(()=>r.get(t.id)).toThrow();
});
it("detects missing dependencies and rejects stale previews, equal versions and invalid manifests",async()=>{
 const {r,pkg}=await fixture();await update(pkg,m=>m.requiredTools.push("custom.absent"));
 const a=await r.previewPackage(pkg),b=await r.previewPackage(pkg);expect(a.missingTools).toEqual(["custom.absent"]);r.install(a.token);
 expect(()=>r.install(b.token)).toThrow(/变化/);expect(()=>r.enable(a.definition.id,true)).toThrow(/缺少/);await expect(r.previewPackage(pkg)).rejects.toThrow(/升级版本/);
 r.remove(a.definition.id);await update(pkg,m=>m.surprise="code");await expect(r.previewPackage(pkg)).rejects.toThrow();
});
it("rejects duplicate tool dependencies, empty instructions and embedded known credentials",async()=>{
 const {r,pkg,core}=await fixture();await update(pkg,m=>m.optionalTools.push(m.requiredTools[0]));await expect(r.previewPackage(pkg)).rejects.toThrow(/重复/);
 await update(pkg,m=>m.optionalTools.pop());await writeFile(path.join(pkg,"instructions.md")," ");await expect(r.previewPackage(pkg)).rejects.toThrow(/不能为空/);
 core.store.setSecret("skill-secret-for-test");await writeFile(path.join(pkg,"instructions.md"),"skill-secret-for-test");await expect(r.previewPackage(pkg)).rejects.toThrow(/凭据/);
});
