import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Collapse, Empty, Select, Space, Statistic, Tag, Timeline, Typography } from "antd";
import type { ExecutionTrace } from "../../shared/trace";
import { call, reportError } from "../api";
import RiskDetails from "../components/RiskDetails";
type Row={id:string;source:"agent"|"workflow";title:string;status:string;createdAt:string};
export default function ExecutionRuns(){
 const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState(""),[trace,setTrace]=useState<ExecutionTrace>(),[kind,setKind]=useState("all"),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{const list=await call<Row[]>("studio.trace.list");setRows(list);const row=list.find(r=>`${r.source}:${r.id}`===selected);if(row)setTrace(await call("studio.trace.get",{source:row.source,id:row.id}));else setTrace(undefined);},[selected]);
 useEffect(()=>{void load().catch(reportError);let timer:ReturnType<typeof setTimeout>;const off=window.sre?.subscribe(e=>{if(e.type==="changed"){clearTimeout(timer);timer=setTimeout(()=>void load().catch(reportError),300);}});return()=>{clearTimeout(timer);off?.();};},[load]);
 const exportTrace=async(format:"json"|"markdown")=>{if(!trace)return;setBusy(true);try{await call("studio.trace.export",{source:trace.source,id:trace.id,format});}catch(e){reportError(e);}finally{setBusy(false);}};
 const events=trace?.events.filter(e=>kind==="all"||e.kind===kind)??[];
 return <>
  <Card style={{marginBottom:16}}><Typography.Title level={3}>Runs · 执行记录</Typography.Title><Typography.Paragraph type="secondary">版本、风险、审批、实际输出与恢复证据。记录结构化摘要，不采集隐藏思维链。</Typography.Paragraph><Select aria-label="选择执行记录" showSearch optionFilterProp="label" value={selected||undefined} placeholder="选择Agent或Workflow运行" style={{width:"100%"}} onChange={setSelected} options={rows.map(r=>({value:`${r.source}:${r.id}`,label:`${r.source==="agent"?"Agent":"Workflow"} · ${r.title} · ${r.status} · ${new Date(r.createdAt).toLocaleString()}`}))}/></Card>
  {!trace?<Empty description="选择运行查看证据时间线"/>:<>
   <Card style={{marginBottom:16}}><Space wrap style={{width:"100%",justifyContent:"space-between"}}><Space><Typography.Title level={4}>{trace.title}</Typography.Title><Tag>{trace.status}</Tag></Space><Space><Button loading={busy} onClick={()=>void exportTrace("json")}>导出 Trace JSON</Button><Button loading={busy} onClick={()=>void exportTrace("markdown")}>导出 Trace Markdown</Button></Space></Space><Typography.Paragraph>{trace.summary}</Typography.Paragraph>
    <Space wrap size="large"><Statistic title="工具请求" value={trace.metrics.toolCalls}/><Statistic title="工具失败" value={trace.metrics.toolFailures}/><Statistic title="模型调用" value={trace.metrics.modelCalls??"未采集"}/><Statistic title="人工批准" value={trace.metrics.humanApprovals}/><Statistic title="风险拦截" value={trace.metrics.riskBlocks}/><Statistic title="总耗时（秒）" value={trace.metrics.elapsedMs/1000} precision={1}/></Space>
    <Alert style={{marginTop:16}} type="info" title={`Token用量：${trace.metrics.totalTokens===null?"接口未提供完整用量或旧记录未采集":trace.metrics.totalTokens}；恢复核实 ${trace.metrics.recoveryAttempts} 次，恢复后完成 ${trace.metrics.resumeSuccesses} 次。`}/>
    <Collapse style={{marginTop:12}} items={[{key:"versions",label:"固定版本、目标与权限",children:<pre className="output">{JSON.stringify({versions:trace.versions,target:trace.target,permission:trace.permission},null,2)}</pre>}]}/>
   </Card>
   <Select aria-label="事件类型" value={kind} onChange={setKind} style={{width:240,marginBottom:16}} options={[{value:"all",label:"全部事件"},...Array.from(new Set(trace.events.map(e=>e.kind))).map(value=>({value,label:value}))]}/>
   <Timeline items={events.map(e=>{const risk=e.kind==="risk"?e.data:(e.kind==="risk.assessed"?(e.data as any)?.data:undefined);return {key:e.id,color:e.kind.includes("failed")?"red":e.kind.includes("completed")?"green":"blue",content:<Card size="small"><Space wrap><strong>{e.kind}</strong><Typography.Text type="secondary">{new Date(e.at).toLocaleString()}</Typography.Text></Space><Typography.Paragraph>{e.summary}</Typography.Paragraph>{risk&&typeof risk==="object"&&"factors"in risk&&<RiskDetails risk={risk as any}/>}{e.data!==undefined&&<Collapse size="small" items={[{key:e.id,label:"参数 / 输出 / Evidence",children:<pre className="output">{JSON.stringify(e.data,null,2)}</pre>}]}/>}</Card>};})}/>
   {!!trace.childTraceIds.length&&<Card title="关联子Agent"><Space wrap>{trace.childTraceIds.map(id=><Button key={id} onClick={()=>setSelected(`agent:${id}`)}>{id.slice(0,12)}</Button>)}</Space></Card>}
  </>}
 </>;
}
