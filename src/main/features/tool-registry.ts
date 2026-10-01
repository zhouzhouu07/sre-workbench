import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Backend } from "../core/backend";
import type { AgentPermission, AgentTarget, AgentToolCall } from "../../shared/agent";
import type { ToolDefinition, ToolPackageManifest, ToolPackagePreview, ToolPin, ToolUsage } from "../../shared/studio";
import { toolSchemas, parseTool, toolDecision, isMutation } from "./agent-contract";
import { AgentTools, loopbackUrl, UncertainExecution } from "./agent-tools";
import { sanitizeContext } from "./ai";
import { shellQuote as q } from "../core/safety";
import { validateSchema, validateValue } from "./studio-schema";
import { RiskEngine } from "./risk-engine";
import type { RiskContext } from "../../shared/risk";

interface InstalledTool extends ToolDefinition { script?: string; url?: string }
const now = () => new Date().toISOString();
const hash = (v:unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const id = z.string().min(1).max(100);
const packageSchema = z.object({
  id:z.string().regex(/^custom\.[a-z][a-z0-9_-]{1,50}$/), name:z.string().min(1).max(100),version:z.string().regex(/^\d+\.\d+\.\d+$/),
  description:z.string().min(1).max(3000),category:z.string().min(1).max(60),
  type:z.enum(["remote-script","http"]), inputSchema:z.record(z.string(),z.unknown()),outputSchema:z.record(z.string(),z.unknown()),
  permission:z.enum(["readonly","confirm","autonomous"]),risk:z.number().int().min(0).max(100),timeout:z.number().int().min(1).max(1800),target:z.literal("ssh"),verification:z.literal(false),
  script:z.string().min(1).max(200).optional(),url:z.string().url().max(2000).optional(),
}).strict();
const names:Record<string,string>={list_files:"目录浏览",read_file:"读取文件",write_file:"安全写入文件",make_directory:"创建目录",inspect_system:"系统观测",run_command:"执行命令",http_check:"HTTP检查",host_resources:"主机资源",clock_status:"时钟状态",network_listeners:"监听端口",service_status:"服务状态",service_logs:"服务日志",container_logs:"容器日志",monitoring_query:"监控查询",update_plan:"持久执行计划",service_action:"服务操作",compose_action:"Compose操作",compose_check:"Compose校验",verify_service:"服务验收",verify_file:"文件验收",verify_package:"安装包验收"};

export class ToolRegistry {
  readonly riskEngine=new RiskEngine();
  private executor:AgentTools;
  private pending=new Map<string,{tool:InstalledTool;expires:number}>();
  constructor(private core:Backend,private changed:()=>void){this.executor=new AgentTools(core);}
  init(){
    for(const u of this.core.store.list<ToolUsage>("toolUsage")) if(u.status === "running") this.core.store.put("toolUsage",{...u,status:"unknown",summary:"应用重启，等待关联远端任务核实"});
  }
  private clean(s:string){return this.core.store.redact(sanitizeContext(s),{shortSecrets:"contextual"});}
  private cleanValue(value:unknown):unknown {
    if(typeof value==="string")return this.clean(value);
    if(Array.isArray(value))return value.map(v=>this.cleanValue(v));
    if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,this.cleanValue(v)]));
    return value;
  }
  private builtin(toolId:string):ToolDefinition|undefined {
    if(!Object.hasOwn(toolSchemas,toolId))return;
    const schema=toolSchemas[toolId as keyof typeof toolSchemas];
    const mutation=isMutation({tool:toolId,arguments:{}});
    const stored=this.core.store.get<ToolDefinition>("tools",toolId);
    const common=["list_files","read_file","write_file","make_directory","inspect_system","run_command","http_check","update_plan"].includes(toolId);
    const inputSchema=z.toJSONSchema(schema) as Record<string,unknown>;
    const version=toolId==="verify_file"?"1.1.1":toolId==="update_plan"?"1.1.0":["write_file","make_directory"].includes(toolId)?"1.0.1":"1.0.0";
    const definition:ToolDefinition={id:toolId,name:names[toolId]??toolId,description:`内置${names[toolId]??toolId}；使用既有参数校验、目标与权限规则。`,version,source:"builtin",category:toolId==="update_plan"?"计划":mutation?"变更":["verify_file","verify_package","verify_service","http_check","compose_check"].includes(toolId)?"验收":"诊断",targetType:common?"both":"ssh",inputSchema,outputSchema:{description:"保留既有工具结果：文本或含code、stdout、结构化检查项的对象；成功采集不等于业务验收成功。",anyOf:[{type:"string"},{type:"object"}]},permissionRequirement:toolId==="update_plan"?"plan":mutation?"mutation":"readonly",baseRisk:mutation?(toolId==="run_command"?70:40):5,timeout:toolId==="compose_action"?600:toolId==="run_command"?300:120,enabled:stored?.enabled??true,executorType:"builtin",verificationCapability:["verify_file","verify_package","verify_service","http_check","compose_check"].includes(toolId),createdAt:"2026-09-30T00:00:00.000Z",updatedAt:stored?.updatedAt??"2026-09-30T00:00:00.000Z",digest:hash({toolId,inputSchema,version})};
    return definition;
  }
  get(toolId:string):ToolDefinition {const value=this.builtin(toolId)??this.core.store.get<InstalledTool>("tools",toolId);if(!value)throw new Error(`工具不存在：${toolId}`);const {script,url,...safe}=value as InstalledTool;return safe;}
  list():ToolDefinition[]{return [...Object.keys(toolSchemas).map(k=>this.get(k)),...this.core.store.list<InstalledTool>("tools").filter(t=>t.source==="imported").map(t=>this.get(t.id))];}
  version(toolId:string){const {id,version,digest}=this.get(toolId);return {id,version,digest};}
  pins(){return this.list().filter(t=>t.enabled).map(t=>this.version(t.id));}
  validateTarget(target:AgentTarget){return this.executor.validateTarget(target);}
  validate(value:unknown,pin?:ToolPin):AgentToolCall {
    const c=z.object({tool:id,arguments:z.record(z.string(),z.unknown())}).strict().parse(value), tool=this.get(c.tool);
    if(!tool.enabled)throw new Error(`工具已禁用：${tool.id}`);
    if(pin && (pin.id!==tool.id||pin.version!==tool.version||pin.digest!==tool.digest))throw new Error("工具版本已变化，请新建任务；不会替换历史任务执行器");
    if(tool.source==="builtin")return parseTool(c);
    validateValue(tool.inputSchema,c.arguments);
    return c;
  }
  decision(permission:AgentPermission,call:AgentToolCall):"allow"|"confirm"|"deny" {
    const t=this.get(call.tool);if(!t.enabled)return "deny";
    if(t.source==="builtin")return toolDecision(permission,call);
    if(permission==="advice"||permission==="readonly"||t.baseRisk>=81)return "deny";
    return "confirm"; // Untrusted package labels cannot grant autonomous execution.
  }
  mutation(call:AgentToolCall){return this.get(call.tool).permissionRequirement==="mutation";}
  assess(permission:AgentPermission,call:AgentToolCall,target:AgentTarget,context:RiskContext={}){return this.riskEngine.evaluate(this.get(call.tool),call,target,permission,context);}
  enable(toolId:string,enabled:boolean){const t=this.get(toolId);this.core.store.put("tools",{...(this.core.store.get<InstalledTool>("tools",toolId)??t),enabled,updatedAt:now()});this.changed();return this.get(toolId);}
  disable(toolId:string){return this.enable(toolId,false);}
  unregister(toolId:string){if(this.get(toolId).source!=="imported")throw new Error("内置工具不能卸载，可禁用");this.core.store.remove("tools",toolId);this.changed();return true;}
  register(tool:InstalledTool){if(this.list().some(t=>t.id===tool.id))throw new Error("Duplicate ID：工具已存在，请先明确卸载旧版本");this.core.store.put("tools",tool);this.changed();return this.get(tool.id);}
  async readPackageFile(root:string,file:string,limit:number){
    if(path.isAbsolute(file)||file.includes("\\")||file.split("/").some(s=>s===".."||s===""||s==="."))throw new Error("包文件路径无效");
    const absolute=path.resolve(root,file),relative=path.relative(root,absolute);if(relative.startsWith("..")||path.isAbsolute(relative))throw new Error("包路径越界");
    let segment=root;for(const p of relative.split(path.sep)){segment=path.join(segment,p);const st=await fs.lstat(segment);if(st.isSymbolicLink())throw new Error("包不支持符号链接");}
    const handle=await fs.open(absolute,"r");try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw new Error("包文件必须为限额内普通文件");const resolved=await fs.realpath(absolute);if(resolved!==absolute)throw new Error("包文件路径发生变化");const buffer=Buffer.alloc(limit+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>limit)throw new Error("包文件过大");const content=buffer.subarray(0,bytesRead).toString("utf8");if(content.includes("\0")||this.clean(content)!==content)throw new Error("包包含凭据、敏感信息或无效字符，请移除后导入");return content;}finally{await handle.close();}
  }
  async previewPackage(directory:string):Promise<ToolPackagePreview>{
    const root=await fs.realpath(directory);const m=packageSchema.parse(JSON.parse(await this.readPackageFile(root,"manifest.json",32768))) as ToolPackageManifest;
    validateSchema(m.inputSchema);validateSchema(m.outputSchema);if(m.inputSchema.type!=="object")throw new Error("输入Schema必须为object");
    if(this.list().some(t=>t.id===m.id))throw new Error("Duplicate ID：工具已存在");
    let script:string|undefined,url:string|undefined;
    if(m.type==="remote-script"){if(!m.script||m.url)throw new Error("脚本包只能声明script");script=await this.readPackageFile(root,m.script,90000);if(!script.trim())throw new Error("脚本不能为空");}
    else {if(!m.url||m.script)throw new Error("HTTP包只能声明url");url=loopbackUrl(m.url);const u=new URL(url);if(u.search||u.hash||u.username||u.password)throw new Error("HTTP地址不允许凭据、片段和预设查询参数");}
    const readme=await this.readPackageFile(root,"README.md",20000),stamp=now();
    const tool:InstalledTool={id:m.id,name:m.name,description:m.description,version:m.version,source:"imported",category:m.category,targetType:"ssh",inputSchema:m.inputSchema,outputSchema:m.outputSchema,permissionRequirement:"mutation",baseRisk:Math.max(60,m.risk),timeout:m.timeout,enabled:false,executorType:m.type,verificationCapability:false,createdAt:stamp,updatedAt:stamp,digest:hash({m,script,url}),readme,script,url};
    const token=randomUUID();for(const [k,v] of this.pending)if(v.expires<Date.now())this.pending.delete(k);if(this.pending.size>=20)throw new Error("导入预览过多，请先完成安装");this.pending.set(token,{tool,expires:Date.now()+600000});
    const {script:code,url:endpoint,...definition}=tool;return {token,definition,script:code,url:endpoint,warnings:["导入不执行，安装后默认禁用。","自定义工具统一按变更处理，必须审批；风险81以上拒绝执行。","包的验收声明不能代替内置独立验收。"]};
  }
  install(token:string){const p=this.pending.get(token);this.pending.delete(token);if(!p||p.expires<Date.now())throw new Error("导入预览失效，请重新选择目录");return this.register(p.tool);}
  usage(toolId?:string){return this.core.store.list<ToolUsage>("toolUsage").filter(u=>!toolId||u.toolId===toolId).slice(-100).reverse();}
  recordPlan(target:AgentTarget,permission:AgentPermission){const t=this.get("update_plan");this.core.store.put<ToolUsage>("toolUsage",{id:randomUUID(),toolId:t.id,version:t.version,digest:t.digest,target,permission,startedAt:now(),finishedAt:now(),status:"succeeded",summary:"计划已保存，不代表主机操作完成"});this.changed();}
  recoverResult(toolId:string,digest:string|undefined,taskId:string,result:{code:number;stdout:string}) {
    let error:string|undefined;let data:unknown;let toolVersion:string|undefined;
    if(toolId.startsWith("custom.") && result.code===0) {
      try {const definition=this.get(toolId);if(!digest||definition.digest!==digest)throw new Error("版本不可用");data=JSON.parse(result.stdout);validateValue(definition.outputSchema,data);data=this.cleanValue(data);toolVersion=definition.version;}
      catch {error="远端命令已结束，但自定义工具原版本或输出Schema无法核实；保留失败状态，请检查现场，勿盲目重试。";}
    }
    const status=error||result.code!==0?"failed":"succeeded";
    for(const usage of this.core.store.list<ToolUsage>("toolUsage").filter(u=>u.taskId===taskId))this.core.store.put("toolUsage",{...usage,status,finishedAt:now(),summary:error});
    this.changed();return {status,error,...(toolVersion?{data,toolVersion,evidence:{toolId,taskId,observedAt:now(),recovered:true}}:{})};
  }
  async execute(target:AgentTarget,permission:AgentPermission,input:AgentToolCall,approved:boolean,signal:AbortSignal,onTask:(id:string)=>void,pin?:ToolPin,context:RiskContext={}):Promise<unknown>{
    const call=this.validate(input,pin),definition=this.get(call.tool);
    const risk=this.assess(permission,call,target,context),decision=risk.action;
    if(decision==="deny"||(decision==="confirm"&&!approved)){this.core.store.put<ToolUsage>("toolUsage",{id:randomUUID(),toolId:definition.id,version:definition.version,digest:definition.digest,target,permission,risk,startedAt:now(),finishedAt:now(),status:"rejected",summary:risk.reason});this.changed();throw new Error(`工具权限/风险策略拒绝：${risk.reason}`);}
    if(definition.targetType==="ssh"&&target.kind!=="ssh")throw new Error("工具仅支持授权SSH目标");
    if(definition.source==="imported"&&!pin)throw new Error("自定义工具执行缺少固定版本快照");
    if(signal.aborted)throw new Error("任务已停止");
    const usage:ToolUsage={id:randomUUID(),toolId:definition.id,version:definition.version,digest:definition.digest,target,permission,risk,startedAt:now(),status:"running"};this.core.store.put("toolUsage",usage);this.changed();
    try{
      let routed=call;
      if(definition.source==="imported"){
        const installed=this.core.store.get<InstalledTool>("tools",definition.id)!;
        const encoded=Buffer.from(JSON.stringify(call.arguments)).toString("base64");
        let command:string;
        if(installed.executorType==="remote-script")command=`export SRE_TOOL_INPUT=$(printf %s ${q(encoded)} | base64 -d)\n/bin/bash -e -s <<'SRE_SCRIPT_${installed.digest}'\n${installed.script}\nSRE_SCRIPT_${installed.digest}`;
        else {const endpoint=new URL(installed.url!);for(const [k,v] of Object.entries(call.arguments))endpoint.searchParams.set(k,typeof v==="string"?v:JSON.stringify(v));command=`curl -q --request GET --proto '=http' --noproxy '*' --silent --show-error --fail --max-time ${installed.timeout} --max-filesize 100000 -- ${q(endpoint.toString())}`;}
        routed={tool:"run_command",arguments:{command,timeout:definition.timeout}};
      }
      const result:any=await this.executor.execute(target,permission,routed,approved,signal,taskId=>{usage.taskId=taskId;this.core.store.put("toolUsage",usage);onTask(taskId);});
      let data:unknown;
      if(definition.source==="imported"&&result?.code===0){try{data=JSON.parse(result.stdout);validateValue(definition.outputSchema,data,"工具输出");}catch{throw new Error("工具输出不符合声明的JSON Schema；变更可能已执行，先核实结果，不盲目重试");}}
      usage.status=result&&typeof result==="object"&&"code" in result&&result.code!==0?"failed":"succeeded";
      return definition.source==="imported"?this.cleanValue({...result,data,toolVersion:definition.version,evidence:{toolId:definition.id,usageId:usage.id,taskId:usage.taskId,observedAt:now()}}):result;
    }catch(error){usage.status=error instanceof UncertainExecution?"unknown":"failed";usage.summary=this.clean(error instanceof Error?error.message:String(error));throw error;}
    finally{usage.finishedAt=now();this.core.store.put("toolUsage",usage);this.changed();}
  }
  async handle(method:string,params:unknown={}){
    if(method==="studio.tool.list"){z.object({}).strict().parse(params);return this.list();}
    if(method==="studio.tool.get")return this.get(z.object({id}).strict().parse(params).id);
    if(method==="studio.tool.enable"){const p=z.object({id,enabled:z.boolean()}).strict().parse(params);return this.enable(p.id,p.enabled);}
    if(method==="studio.tool.remove")return this.unregister(z.object({id}).strict().parse(params).id);
    if(method==="studio.tool.usage")return this.usage(z.object({id:id.optional()}).strict().parse(params).id);
    if(method==="studio.tool.preview"){z.object({}).strict().parse(params);const directory=await this.core.handle("dialog.open",{mode:"directory"});return directory?this.previewPackage(String(directory)):null;}
    if(method==="studio.tool.install")return this.install(z.object({token:z.string().uuid()}).strict().parse(params).token);
    throw new Error("不支持的Tool Center操作");
  }
}
