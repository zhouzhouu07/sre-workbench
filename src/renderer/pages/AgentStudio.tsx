import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Descriptions, Empty, Input, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography } from "antd";
import { ImportOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ToolDefinition, ToolPackagePreview, ToolUsage } from "../../shared/studio";
import { call, reportError } from "../api";
import SkillCenter from "./SkillCenter";
import AgentBuilder from "./AgentBuilder";
import WorkflowStudio from "./WorkflowStudio";
import ExecutionRuns from "./ExecutionRuns";
import Benchmark from "./Benchmark";

const risk = (score:number) => score<=20?{label:"低",color:undefined}:score<=50?{label:"中",color:undefined}:score<=80?{label:"高",color:"orange"}:{label:"严重",color:"red"};
const permission={readonly:"只读",mutation:"变更",plan:"本地计划"};
function Schemas({tool}:{tool:ToolDefinition}){
  return <Tabs items={[
    {key:"input",label:"Input Schema",children:<pre className="output">{JSON.stringify(tool.inputSchema,null,2)}</pre>},
    {key:"output",label:"Output Schema",children:<pre className="output">{JSON.stringify(tool.outputSchema,null,2)}</pre>},
    {key:"readme",label:"使用说明",children:<Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{tool.readme||tool.description}</Typography.Paragraph>},
  ]}/>;
}
function ToolCenter(){
  const [tools,setTools]=useState<ToolDefinition[]>([]),[busy,setBusy]=useState(false),[search,setSearch]=useState(""),[source,setSource]=useState("all"),[category,setCategory]=useState("all");
  const [selectedId,setSelectedId]=useState(""),[usage,setUsage]=useState<ToolUsage[]>([]),[usageLoading,setUsageLoading]=useState(false),[usageError,setUsageError]=useState(""),[usageRevision,setUsageRevision]=useState(0),[preview,setPreview]=useState<ToolPackagePreview>();
  const selected=tools.find(t=>t.id===selectedId);
  const load=useCallback(async()=>{setTools(await call<ToolDefinition[]>("studio.tool.list"));setUsageRevision(v=>v+1);},[]);
  useEffect(()=>{void load().catch(reportError);let timer:ReturnType<typeof setTimeout>;const off=window.sre?.subscribe(e=>{if(e.type==="changed"){clearTimeout(timer);timer=setTimeout(()=>void load().catch(reportError),200);}});return()=>{clearTimeout(timer);off?.();};},[load]);
  const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn();await load();}catch(e){reportError(e);}finally{setBusy(false);}};
  useEffect(()=>{let disposed=false;setUsage([]);setUsageError("");if(!selectedId){setUsageLoading(false);return;}setUsageLoading(true);void call<ToolUsage[]>("studio.tool.usage",{id:selectedId}).then(value=>{if(!disposed)setUsage(value);}).catch(e=>{if(!disposed)setUsageError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!disposed)setUsageLoading(false);});return()=>{disposed=true;};},[selectedId,usageRevision]);
  const details=(t:ToolDefinition)=>{setSelectedId(t.id);setUsageRevision(v=>v+1);};
  const rows=tools.filter(t=>(source==="all"||t.source===source)&&(category==="all"||t.category===category)&&`${t.name} ${t.id} ${t.description}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="studio-toolbar">
      <Space wrap style={{width:"100%",justifyContent:"space-between"}}>
        <div><Typography.Title level={4}>Tool Center · 工具中心</Typography.Title><Typography.Text type="secondary">{tools.length} 项工具 · 版本、权限与执行入口</Typography.Text></div>
        <Space><Button icon={<ReloadOutlined/>} onClick={()=>void load().catch(reportError)}>刷新工具</Button><Button type="primary" icon={<ImportOutlined/>} loading={busy} onClick={()=>action(async()=>{const p=await call<ToolPackagePreview|null>("studio.tool.preview");if(p)setPreview(p);})}>导入工具包</Button></Space>
      </Space>
    </div>
    <Typography.Paragraph type="secondary">自定义工具安装后默认禁用；启用后仍需逐次审批，严重风险拒绝执行。禁用不撤销已提交作业。</Typography.Paragraph>
    <Space wrap style={{marginBottom:16}}>
      <Input.Search aria-label="搜索工具" placeholder="搜索名称或工具 ID" value={search} onChange={e=>setSearch(e.target.value)} style={{width:280}}/>
      <Select aria-label="工具来源" value={source} onChange={setSource} style={{width:140}} options={[{value:"all",label:"全部来源"},{value:"builtin",label:"内置"},{value:"imported",label:"导入"}]}/>
      <Select aria-label="工具分类" value={category} onChange={setCategory} style={{width:160}} options={[{value:"all",label:"全部分类"},...Array.from(new Set(tools.map(t=>t.category))).map(v=>({value:v,label:v}))]}/>
    </Space>
    <div className={`registry-workspace${selected?" has-inspector":""}`}><div className="registry-list"><Table size="small" rowKey="id" dataSource={rows} scroll={{x:850}} pagination={{pageSize:10}} columns={[
      {title:"工具",key:"name",width:180,fixed:"left",render:(_,t)=><><Button type="link" onClick={()=>void details(t)}>{t.name}</Button><div className="muted">{t.id}</div></>},
      {title:"来源",key:"source",render:(_,t)=><Tag>{t.source==="builtin"?"内置":"导入"}</Tag>},
      {title:"分类",dataIndex:"category"},{title:"版本",dataIndex:"version"},
      {title:"权限",key:"permission",render:(_,t)=>permission[t.permissionRequirement]},
      {title:"基础风险",key:"risk",render:(_,t)=><Tag color={risk(t.baseRisk).color}>{risk(t.baseRisk).label} · {t.baseRisk}</Tag>},
      {title:"启用",key:"enabled",render:(_,t)=><Switch aria-label={`启用 ${t.id}`} checked={t.enabled} disabled={busy} onChange={enabled=>action(()=>call("studio.tool.enable",{id:t.id,enabled}))}/>},
      {title:"操作",key:"actions",width:110,fixed:"right",render:(_,t)=><Space size={4} wrap><Button size="small" onClick={()=>void details(t)}>详情</Button>{t.source==="imported"&&<Button size="small" danger disabled={busy} onClick={()=>Modal.confirm({title:`卸载 ${t.name}？`,content:"仅移除工具注册，历史记录和远端数据保留。已开始的作业不会撤销。",onOk:()=>action(()=>call("studio.tool.remove",{id:t.id}))})}>卸载</Button>}</Space>},
    ]}/></div>
    {selected&&<aside className="registry-inspector" aria-label="工具详情"><div className="inspector-heading"><strong>{selected.name} · {selected.version}</strong><Button size="small" type="text" aria-label="关闭" onClick={()=>setSelectedId("")}>关闭</Button></div><Typography.Paragraph>{selected.description}</Typography.Paragraph><Descriptions size="small" column={1} items={[
        {key:"id",label:"ID",children:selected.id},{key:"source",label:"来源",children:selected.source},
        {key:"target",label:"目标",children:selected.targetType==="ssh"?"SSH Linux":"兼容原目标"},{key:"executor",label:"执行器",children:selected.executorType},
        {key:"timeout",label:"超时上限",children:`${selected.timeout} 秒（内置命令可按参数设置）`},{key:"verify",label:"内置验收能力",children:selected.verificationCapability?"是":"否"},
        {key:"created",label:"创建",children:selected.createdAt},{key:"updated",label:"更新",children:selected.updatedAt},
      ]}/><Typography.Paragraph copyable style={{wordBreak:"break-all"}}>版本摘要：{selected.digest}</Typography.Paragraph><Schemas tool={selected}/><Typography.Title level={4}>最近使用</Typography.Title>
      {usageLoading?<Spin/>:usageError?<Alert type="error" title="使用记录加载失败" description={usageError}/>:!usage.length?<Empty description="暂无执行记录"/>:<Table size="small" rowKey="id" dataSource={usage} pagination={{pageSize:8}} columns={[{title:"时间",dataIndex:"startedAt"},{title:"版本",dataIndex:"version"},{title:"状态",dataIndex:"status"},{title:"远端作业",dataIndex:"taskId",ellipsis:true}]} />}</aside>}
    </div>
    <Modal title="审阅工具包并安装" open={!!preview} onCancel={()=>setPreview(undefined)} width={850} confirmLoading={busy} okText="安装（默认禁用）" onOk={()=>action(async()=>{await call("studio.tool.install",{token:preview!.token});setPreview(undefined);})}>
      {preview&&<><Typography.Title level={4}>{preview.definition.name} · {preview.definition.version}</Typography.Title><Typography.Paragraph>{preview.definition.id} · {preview.definition.description}</Typography.Paragraph><Alert type="warning" title={preview.warnings.join(" ")}/><Typography.Paragraph>基础风险：{preview.definition.baseRisk} · 超时：{preview.definition.timeout}秒 · 目标：SSH</Typography.Paragraph><Schemas tool={preview.definition}/><Typography.Title level={5}>执行内容（安装不会执行）</Typography.Title><pre className="output">{preview.script??`HTTP GET ${preview.url}`}</pre><Typography.Text type="secondary">摘要：{preview.definition.digest}</Typography.Text></>}
    </Modal>
  </>;
}
export default function AgentStudio(){return <div className="studio-workspace"><Typography.Title level={3}>Agent Studio</Typography.Title><Tabs items={[{key:"agents",label:"Agents · 助手",children:<AgentBuilder/>},{key:"workflows",label:"Workflows · 流程",children:<WorkflowStudio/>},{key:"skills",label:"Skills · 技能",children:<SkillCenter/>},{key:"tools",label:"Tools · 工具",children:<ToolCenter/>},{key:"runs",label:"Runs · 执行记录",children:<ExecutionRuns/>},{key:"benchmark",label:"Benchmark · 实验",children:<Benchmark/>}]}/></div>;}
