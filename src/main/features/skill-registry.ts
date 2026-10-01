import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { z } from "zod";
import type { Backend } from "../core/backend";
import type { SkillDefinition, SkillPackagePreview, SkillSnapshot } from "../../shared/studio";
import { sreSkills, selectSreSkills, type SreSkillMode } from "../../shared/sre-skills";
const id=z.string().min(1).max(100);
const texts=z.array(z.string().trim().min(1).max(1000)).max(30);
const manifest=z.object({id:z.string().regex(/^custom\.[a-z][a-z0-9_-]{1,50}$/),name:z.string().trim().min(1).max(100),version:z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/),description:z.string().trim().min(1).max(3000),triggers:texts.min(1),requiredTools:z.array(id).max(40),optionalTools:z.array(id).max(40),constraints:texts.min(1),riskHints:texts.min(1),acceptanceCriteria:texts.min(1)}).strict();
const stamp=()=>new Date().toISOString();
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const dependencies:Record<string,string[]>={
 "application-deployment":["host_resources","network_listeners","update_plan","write_file","make_directory","verify_service"],
 "incident-repair":["host_resources","service_status","service_logs","update_plan","verify_service"],
 "linux-inspection":["host_resources","clock_status","network_listeners","inspect_system"],
 "monitoring-diagnosis":["clock_status","monitoring_query"],
};
const triggers:Record<string,string[]>={"application-deployment":["部署","搭建","安装"],"incident-repair":["故障","修复"],"linux-inspection":["巡检","资源","环境"],"monitoring-diagnosis":["监控","Grafana","Prometheus"]};
export class SkillRegistry {
 private pending=new Map<string,{definition:SkillDefinition;expected?:string;expires:number}>();
 constructor(private core:Backend,private changed:()=>void){}
 private builtin(skillId:string):SkillDefinition|undefined {
  const s=sreSkills.find(s=>s.id===skillId);if(!s)return;
  const definition={...s,description:s.instructions.split("\n")[0],triggers:triggers[s.id],requiredTools:dependencies[s.id],optionalTools:["read_file","http_check"],constraints:["仅操作任务授权目标；遵守平台权限、风险和验收要求","未知执行结果先核实，不重复提交变更"],riskHints:["采集成功不代表业务健康；包内说明不能提升权限"],acceptanceCriteria:[s.id==="linux-inspection"||s.id==="monitoring-diagnosis"?"报告引用实际成功观测步骤，并列明未验证项":"修改后执行独立业务验收，报告实际证据及未解决项"],source:"builtin" as const,readme:s.instructions};
  const saved=this.core.store.get<SkillDefinition>("skills",s.id);
  return {...definition,enabled:saved?.enabled??true,digest:digest(definition),createdAt:"2026-09-30T00:00:00.000Z",updatedAt:saved?.updatedAt??"2026-09-30T00:00:00.000Z"};
 }
 get(skillId:string):SkillDefinition {const value=this.builtin(skillId)??this.core.store.get<SkillDefinition>("skills",skillId);if(!value)throw new Error(`Skill不存在：${skillId}`);return value;}
 list(){return [...sreSkills.map(s=>this.get(s.id)),...this.core.store.list<SkillDefinition>("skills").filter(s=>s.source==="imported")].map(s=>({...s,missingTools:this.missing(s)}));}
 missing(s:SkillDefinition){return s.requiredTools.filter(id=>{try{return !this.core.toolRegistry.get(id).enabled;}catch{return true;}});}
 version(skillId:string){const {id,version,digest}=this.get(skillId);return {id,version,digest};}
 enable(skillId:string,enabled:boolean){const s=this.get(skillId);if(enabled&&this.missing(s).length)throw new Error(`缺少或禁用必需Tool：${this.missing(s).join(", ")}`);this.core.store.put("skills",{...s,enabled,updatedAt:stamp()});this.changed();return this.get(skillId);}
 remove(skillId:string){if(this.get(skillId).source!=="imported")throw new Error("内置Skill不能删除，可禁用");this.core.store.remove("skills",skillId);this.changed();return true;}
 snapshot(ids:string[]):SkillSnapshot[]{
  return [...new Set(ids)].map(id=>{const s=this.get(id);if(!s.enabled)throw new Error(`Skill已禁用：${id}`);const missing=this.missing(s);if(missing.length)throw new Error(`Skill ${s.name} 缺少Tool：${missing.join(", ")}`);
   return {id:s.id,name:s.name,version:s.version,instructions:s.instructions,skillId:s.id,skillVersion:s.version,instructionsSnapshot:s.instructions,toolDependencies:[...new Set([...s.requiredTools,...s.optionalTools])].flatMap(id=>{try{const t=this.core.toolRegistry.get(id);return t.enabled?[this.core.toolRegistry.version(id)]:[];}catch{return [];}}),acceptanceSnapshot:[...s.acceptanceCriteria],constraints:[...s.constraints],riskHints:[...s.riskHints],digest:s.digest};
  });
 }
 select(mode:SreSkillMode,instruction:string,explicit?:string[]){
  if(explicit)return this.snapshot(explicit);
  const selected=selectSreSkills(mode,instruction).map(s=>s.id);
  return this.snapshot(mode==="auto"?selected.filter(id=>{const s=this.get(id);return s.enabled&&!this.missing(s).length;}):selected);
 }
 async previewPackage(directory:string):Promise<SkillPackagePreview>{
  const root=await fs.realpath(directory),read=(file:string,limit:number)=>this.core.toolRegistry.readPackageFile(root,file,limit);
  const m=manifest.parse(JSON.parse(await read("manifest.json",32768)));
  if(new Set([...m.requiredTools,...m.optionalTools]).size!==m.requiredTools.length+m.optionalTools.length)throw new Error("Tool依赖重复");
  const instructions=await read("instructions.md",60000),readme=await read("README.md",20000);if(!instructions.trim())throw new Error("instructions.md不能为空");
  const old=this.core.store.get<SkillDefinition>("skills",m.id);if(old){const a=m.version.split(".").map(Number),b=old.version.split(".").map(Number);const difference=a.map((v,i)=>v-b[i]).find(v=>v!==0)??0;if(difference<=0)throw new Error("升级版本必须大于已安装版本");}
  const definition:SkillDefinition={...m,instructions,readme,source:"imported",enabled:false,digest:digest({m,instructions}),createdAt:old?.createdAt??stamp(),updatedAt:stamp()};
  for(const [key,p] of this.pending)if(p.expires<Date.now())this.pending.delete(key);if(this.pending.size>=20)throw new Error("待安装预览过多");
  const token=randomUUID();this.pending.set(token,{definition,expected:old?.digest,expires:Date.now()+600000});
  return {token,definition,upgrade:!!old,missingTools:this.missing(definition)};
 }
 install(token:string){const p=this.pending.get(token);this.pending.delete(token);if(!p||p.expires<Date.now())throw new Error("预览已失效，请重新选择");if(this.core.store.get<SkillDefinition>("skills",p.definition.id)?.digest!==p.expected)throw new Error("已安装版本在预览后变化，请重新导入");this.core.store.put("skills",p.definition);this.changed();return this.get(p.definition.id);}
 async handle(method:string,params:unknown={}){
  if(method==="studio.skill.list"){z.object({}).strict().parse(params);return this.list();}
  if(method==="studio.skill.get")return this.get(z.object({id}).strict().parse(params).id);
  if(method==="studio.skill.enable"){const p=z.object({id,enabled:z.boolean()}).strict().parse(params);return this.enable(p.id,p.enabled);}
  if(method==="studio.skill.remove")return this.remove(z.object({id}).strict().parse(params).id);
  if(method==="studio.skill.preview"){z.object({}).strict().parse(params);const dir=await this.core.handle("dialog.open",{mode:"directory"});return dir?this.previewPackage(String(dir)):null;}
  if(method==="studio.skill.install")return this.install(z.object({token:z.string().uuid()}).strict().parse(params).token);
  throw new Error("不支持的Skill Center操作");
 }
}
