import type { WorkflowNode } from "../../shared/workflow";
const n=(id:string,type:WorkflowNode["type"],config:Record<string,unknown>,next?:string,extra:Partial<WorkflowNode>={}):WorkflowNode=>({id,type,label:id,x:40,y:0,config,next,...extra});
export function workflowTemplates(){return [
 {id:"workflow.web-healing",name:"Web服务故障自愈",description:"输入unit、url、instruction。先观测与诊断，审阅后启动指定服务，最后独立验证。Agent模板需绑定模型。",nodes:[
  n("start","Start",{},"input"),n("input","Input",{required:["unit","url","instruction"]},"status"),
  n("status","Tool",{tool:"service_status",arguments:{unit:{$ref:"input.unit"}}},"healthy"),
  n("healthy","Condition",{left:{$ref:"outputs.status.stdout"},op:"contains",right:"ActiveState=active"},"verify",{otherwise:"logs"}),
  n("logs","Tool",{tool:"service_logs",arguments:{unit:{$ref:"input.unit"},lines:80}},"diagnose"),
  n("diagnose","Agent",{agentId:"template.web-diagnosis",instruction:{$ref:"input.instruction"}},"approval"),
  n("approval","Approval",{toolNodeId:"repair"},"repair"),
  n("repair","Tool",{tool:"service_action",arguments:{unit:{$ref:"input.unit"},action:"start"}},"verify"),
  n("verify","Verify",{tool:"verify_service",arguments:{unit:{$ref:"input.unit"},url:{$ref:"input.url"}}},"http"),
  n("http","Verify",{tool:"http_check",arguments:{url:{$ref:"input.url"}}},"end"),n("end","End",{}),
 ]},
 {id:"workflow.application-deployment",name:"应用部署与验收",description:"输入instruction、composeFile、project、url。Agent在获准目录准备应用和Compose文件，随后校验、启动和HTTP验收。",nodes:[
  n("start","Start",{},"input"),n("input","Input",{required:["instruction","composeFile","project","url"]},"inspect"),
  n("inspect","Tool",{tool:"host_resources",arguments:{}},"skill"),n("skill","Skill",{skillId:"application-deployment"},"build"),
  n("build","Agent",{agentId:"template.deployment",instruction:{$ref:"input.instruction"}},"config"),
  n("config","Verify",{tool:"compose_check",arguments:{path:{$ref:"input.composeFile"},project:{$ref:"input.project"}}},"up"),
  n("up","Tool",{tool:"compose_action",arguments:{path:{$ref:"input.composeFile"},project:{$ref:"input.project"},action:"up"}},"verify"),
  n("verify","Verify",{tool:"verify_service",arguments:{url:{$ref:"input.url"}}},"end"),n("end","End",{}),
 ]},
 ].map(t=>({...t,nodes:t.nodes.map((node,i)=>({...node,x:40+(i%3)*240,y:40+Math.floor(i/3)*140}))}));}
