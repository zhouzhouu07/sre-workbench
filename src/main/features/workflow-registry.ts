import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Backend } from "../core/backend";
import type { WorkflowDefinition } from "../../shared/workflow";
import { graphSchema, validateGraph } from "./workflow-contract";
import { workflowTemplates } from "./workflow-templates";
import { sanitizeContext } from "./ai";
export const workflowHash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class WorkflowRegistry {
 constructor(private core:Backend,private changed:()=>void){}
 private templates():WorkflowDefinition[]{return workflowTemplates().map(t=>({...t,version:"1.0.0",source:"template",createdAt:"2026-09-30T00:00:00.000Z",updatedAt:"2026-09-30T00:00:00.000Z",digest:workflowHash(t)}));}
 list(){const saved=this.core.store.list<WorkflowDefinition>("workflows");return [...this.templates().filter(t=>!saved.some(s=>s.id===t.id)),...saved];}
 get(id:string){const t=this.list().find(t=>t.id===id);if(!t)throw new Error("Workflow不存在");return t;}
 validate(input:unknown){return validateGraph(input,this.core);}
 save(input:unknown){const {id,expectedDigest,...config}=z.object({...graphSchema.shape,id:z.string().max(100).optional(),expectedDigest:z.string().max(100).optional()}).strict().parse(input);const graph=this.validate(config);const old=id?this.get(id):undefined;if(old&&old.digest!==expectedDigest)throw new Error("流程已变化，请刷新后编辑");const serialized=JSON.stringify(graph);if(this.core.store.redact(sanitizeContext(serialized),{shortSecrets:"contextual"})!==serialized)throw new Error("工作流定义不得包含凭据");const t:WorkflowDefinition={...graph,id:old?.id??`workflow.${randomUUID()}`,version:old?`1.0.${Number(old.version.split(".")[2])+1}`:"1.0.0",digest:"",source:old?.source??"custom",createdAt:old?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()};t.digest=workflowHash(t);this.core.store.put("workflows",t);this.changed();return t;}
 async handle(method:string,input:unknown={}){
  if(method==="studio.workflow.list"){z.object({}).strict().parse(input);return this.list();}
  if(method==="studio.workflow.save")return this.save(input);
  if(method==="studio.workflow.validate"){this.validate(input);return {valid:true};}
  if(method==="studio.workflow.clone"){const t=this.get(z.object({id:z.string()}).strict().parse(input).id);return this.save({name:`${t.name} 副本`,description:t.description,nodes:t.nodes});}
  if(method==="studio.workflow.remove"){const t=this.get(z.object({id:z.string()}).strict().parse(input).id);if(t.source==="template")throw new Error("内置模板不能删除");this.core.store.remove("workflows",t.id);this.changed();return true;}
  throw new Error("不支持的Workflow操作");
 }
}
