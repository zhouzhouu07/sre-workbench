import { z } from "zod";
import { workflowNodeTypes, type WorkflowDefinition, type WorkflowNode } from "../../shared/workflow";
import type { Backend } from "../core/backend";
const ident=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const ref=/^(input|outputs)(\.[A-Za-z][A-Za-z0-9_-]*){1,8}$/;
const forbidden=new Set(["__proto__","constructor","prototype"]);
export function validateMapping(v:unknown,depth=0):void {
 if(depth>8)throw new Error("输入映射过深");
 if(v&&typeof v==="object"){
  if(Array.isArray(v)){if(v.length>100)throw new Error("映射数组过长");v.forEach(x=>validateMapping(x,depth+1));return;}
  const obj=v as Record<string,unknown>;
  if(Object.hasOwn(obj,"$ref")){if(Object.keys(obj).length!==1||typeof obj.$ref!=="string"||!ref.test(obj.$ref)||obj.$ref.split(".").some(k=>forbidden.has(k)))throw new Error("非法输入引用");return;}
  for(const [k,val] of Object.entries(obj)){if(forbidden.has(k))throw new Error("非法映射字段");validateMapping(val,depth+1);}
 }else if(typeof v==="string"&&v.length>60000)throw new Error("映射文本过长");
}
export function resolveMapping(v:any,context:{input:unknown;outputs:unknown}):any {
 validateMapping(v);
 if(v&&typeof v==="object"){
  if(Array.isArray(v))return v.map(x=>resolveMapping(x,context));
  if(Object.hasOwn(v,"$ref")){let value:any=context;for(const k of v.$ref.split(".")){if(value===null||typeof value!=="object"||!Object.hasOwn(value,k))throw new Error(`引用无结果：${v.$ref}`);value=value[k];}return structuredClone(value);}
  return Object.fromEntries(Object.entries(v).map(([k,val])=>[k,resolveMapping(val,context)]));
 }return v;
}
export const conditionSchema=z.object({left:z.unknown(),op:z.enum(["eq","ne","gt","gte","lt","lte","contains","exists"]),right:z.unknown().optional()}).strict();
export function condition(value:unknown,context:{input:unknown;outputs:unknown}){
 const c=conditionSchema.parse(value);let left:any;try{left=resolveMapping(c.left,context);}catch(e){if(c.op==="exists")return false;throw e;}
 const right=resolveMapping(c.right,context);switch(c.op){case"exists":return left!==undefined&&left!==null;case"eq":return left===right;case"ne":return left!==right;case"contains":if(typeof left!=="string"||typeof right!=="string")throw new Error("contains仅支持字符串");return left.includes(right);default:if(typeof left!=="number"||typeof right!=="number"||!Number.isFinite(left)||!Number.isFinite(right))throw new Error("大小比较仅支持有限数值");return c.op==="gt"?left>right:c.op==="gte"?left>=right:c.op==="lt"?left<right:left<=right;}
}
const configs:Record<string,z.ZodType>={
 Start:z.object({}).strict(),End:z.object({}).strict(),Input:z.object({required:z.array(ident).max(30)}).strict(),
 Tool:z.object({tool:z.string().min(1).max(100),arguments:z.record(z.string(),z.unknown()),timeout:z.number().int().min(1).max(1800).optional()}).strict(),
 Verify:z.object({tool:z.string().min(1).max(100),arguments:z.record(z.string(),z.unknown())}).strict(),
 Agent:z.object({agentId:z.string().min(1).max(100),instruction:z.unknown()}).strict(),
 Skill:z.object({skillId:z.string().min(1).max(100)}).strict(),Condition:conditionSchema,
 Approval:z.object({toolNodeId:ident}).strict(),Retry:z.object({retryTarget:ident,maxRetries:z.number().int().min(1).max(3),backoff:z.number().int().min(0).max(60)}).strict(),
 Wait:z.object({seconds:z.number().int().min(0).max(300)}).strict(),Output:z.object({value:z.unknown()}).strict(),
};
export const graphSchema=z.object({name:z.string().trim().min(1).max(100),description:z.string().max(3000),nodes:z.array(z.object({id:ident,type:z.enum(workflowNodeTypes),label:z.string().min(1).max(100),x:z.number().min(0).max(5000),y:z.number().min(0).max(10000),config:z.record(z.string(),z.unknown()),next:ident.optional(),onFailure:ident.optional(),otherwise:ident.optional()}).strict()).min(2).max(80)}).strict();
export function validateGraph(input:unknown,core:Backend){
 const graph:Pick<WorkflowDefinition,"name"|"description"|"nodes">=graphSchema.parse(input);const map=new Map(graph.nodes.map(n=>[n.id,n]));
 if(map.size!==graph.nodes.length)throw new Error("节点ID重复");const starts=graph.nodes.filter(n=>n.type==="Start");if(starts.length!==1||!graph.nodes.some(n=>n.type==="End"))throw new Error("流程必须恰好一个Start且至少一个End");
 for(const node of graph.nodes){node.config=configs[node.type].parse(node.config) as any;validateMapping(node.config);
  for(const dest of [node.next,node.onFailure,node.otherwise].filter(Boolean))if(!map.has(dest!))throw new Error(`悬空连接：${dest}`);
  if(node.type==="End"&&(node.next||node.onFailure||node.otherwise))throw new Error("End不能有输出连接");
  if(node.type!=="End"&&!node.next)throw new Error(`节点缺少下一步：${node.id}`);
  if(node.type==="Condition"&&!node.otherwise)throw new Error("Condition需要false分支");if(node.type!=="Condition"&&node.otherwise)throw new Error("非条件节点不能有false分支");
  if(["Tool","Verify"].includes(node.type)){const t=core.toolRegistry.get(node.config.tool);if(t.id==="update_plan")throw new Error("持久计划应通过Agent节点管理");if(node.type==="Verify"&&(!t.verificationCapability||t.source!=="builtin"))throw new Error("Verify必须使用内置独立验收工具");}
  const references=(value:any):void=>{if(value&&typeof value==="object"){if(typeof value.$ref==="string"&&value.$ref.startsWith("outputs.")&&!map.has(value.$ref.split(".")[1]))throw new Error("映射引用不存在的节点输出");Object.values(value).forEach(references);}};references(node.config);
  if(node.type==="Skill")core.skillRegistry.get(node.config.skillId);
  if(node.type==="Agent"){const a=core.agentBuilder.get(node.config.agentId);if(a.workflowId)throw new Error("Agent节点不能递归调用绑定工作流的Agent，请克隆专用定义");}
  if(node.type==="Approval"){const t=map.get(node.config.toolNodeId);if(!t||t.type!=="Tool"||node.next!==t.id)throw new Error("Approval必须直接连接指定Tool节点");}
  if(node.type==="Retry"){const t=map.get(node.config.retryTarget);if(!t||!["Tool","Verify"].includes(t.type)||t.onFailure!==node.id)throw new Error("Retry只能重试直接失败进入本节点的Tool/Verify");}
 }
 const visiting=new Set<string>(),visited=new Set<string>();function walk(id:string){if(visiting.has(id))throw new Error("普通连接存在循环，只允许Retry显式受控重试");if(visited.has(id))return;visiting.add(id);const n=map.get(id)!;for(const to of [n.next,n.onFailure,n.otherwise].filter(Boolean))walk(to!);visiting.delete(id);visited.add(id);}walk(starts[0].id);
 if(visited.size!==map.size)throw new Error("存在不可达节点");
 for(const n of graph.nodes){if(n.type==="Start"&&graph.nodes.some(x=>[x.next,x.onFailure,x.otherwise].includes(n.id)))throw new Error("Start不能有输入连接");}
 return graph;
}
