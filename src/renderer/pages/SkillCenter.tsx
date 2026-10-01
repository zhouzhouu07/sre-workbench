import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Drawer, Input, Modal, Space, Switch, Table, Tag, Typography } from "antd";
import { call, reportError } from "../api";
import type { SkillDefinition, SkillPackagePreview } from "../../shared/studio";
type Row=SkillDefinition&{missingTools:string[]};
function Details({skill}:{skill:SkillDefinition}){return <>
 <Descriptions column={1} items={[
  {key:"version",label:"版本",children:`${skill.id} · ${skill.version}`},
  {key:"triggers",label:"适用场景",children:skill.triggers.join(" / ")},
  {key:"required",label:"必需Tool",children:skill.requiredTools.join(", ")||"无"},
  {key:"optional",label:"可选Tool",children:skill.optionalTools.join(", ")||"无"},
  {key:"constraints",label:"限制",children:skill.constraints.join("；")},
  {key:"risk",label:"风险提示",children:skill.riskHints.join("；")},
  {key:"acceptance",label:"验收标准",children:skill.acceptanceCriteria.join("；")},
 ]}/>
 <Typography.Title level={5}>执行方法</Typography.Title><Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{skill.instructions}</Typography.Paragraph>
 <Typography.Title level={5}>README</Typography.Title><Typography.Paragraph style={{whiteSpace:"pre-wrap"}}>{skill.readme}</Typography.Paragraph>
 <Typography.Paragraph copyable style={{wordBreak:"break-all"}}>摘要：{skill.digest}</Typography.Paragraph>
 </>;}
export default function SkillCenter(){
 const [rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[query,setQuery]=useState("");
 const [selected,setSelected]=useState<Row>(),[preview,setPreview]=useState<SkillPackagePreview>();
 const load=useCallback(async()=>setRows(await call<Row[]>("studio.skill.list")),[]);
 useEffect(()=>{void load().catch(reportError);let timer:ReturnType<typeof setTimeout>;const off=window.sre?.subscribe(e=>{if(e.type==="changed"){clearTimeout(timer);timer=setTimeout(()=>void load().catch(reportError),200);}});return()=>{clearTimeout(timer);off?.();};},[load]);
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn();await load();}catch(e){reportError(e);}finally{setBusy(false);}};
 return <>
  <Card style={{marginBottom:16}}><Space wrap style={{width:"100%",justifyContent:"space-between"}}><div><Typography.Title level={3}>Skill Center · 技能中心</Typography.Title><Typography.Text type="secondary">领域方法、工具依赖、约束与验收 · 运行时保存版本快照</Typography.Text></div><Button type="primary" loading={busy} onClick={()=>action(async()=>{const p=await call<SkillPackagePreview|null>("studio.skill.preview");if(p)setPreview(p);})}>导入 / 升级技能包</Button></Space><Alert style={{marginTop:16}} type="info" showIcon title="技能不会提升权限。禁用影响新任务；已经开始的任务沿用原快照，工具禁用仍会阻止后续调用。"/></Card>
  <Input.Search aria-label="搜索技能" placeholder="搜索技能名称、ID 或场景" value={query} onChange={e=>setQuery(e.target.value)} style={{width:340,marginBottom:16}}/>
  <Table<Row> rowKey="id" dataSource={rows.filter(s=>`${s.name} ${s.id} ${s.triggers.join(" ")}`.toLowerCase().includes(query.toLowerCase()))} pagination={{pageSize:8}} columns={[
   {title:"技能",key:"name",render:(_,s)=><><Button type="link" onClick={()=>setSelected(s)}>{s.name}</Button><div className="muted">{s.id}</div></>},
   {title:"来源",key:"source",render:(_,s)=><Tag>{s.source==="builtin"?"内置":"导入"}</Tag>},
   {title:"版本",dataIndex:"version"},{title:"适用场景",key:"triggers",render:(_,s)=>s.triggers.join(" / ")},
   {title:"Tool依赖",key:"tools",render:(_,s)=>s.missingTools.length?<Tag color="error">缺少：{s.missingTools.join(", ")}</Tag>:<Tag color="success">{s.requiredTools.length} 项必需依赖可用</Tag>},
   {title:"启用",key:"enabled",render:(_,s)=><Switch aria-label={`启用技能 ${s.id}`} checked={s.enabled} disabled={busy||(!s.enabled&&!!s.missingTools.length)} onChange={enabled=>action(()=>call("studio.skill.enable",{id:s.id,enabled}))}/>},
   {title:"操作",key:"actions",render:(_,s)=><Space><Button onClick={()=>setSelected(s)}>详情</Button>{s.source==="imported"&&<Button danger onClick={()=>Modal.confirm({title:`删除技能 ${s.name}？`,content:"历史任务的技能快照保留。",onOk:()=>action(()=>call("studio.skill.remove",{id:s.id}))})}>删除</Button>}</Space>},
  ]}/>
  <Drawer title={selected?.name} size={760} open={!!selected} onClose={()=>setSelected(undefined)}>{selected&&<Details skill={selected}/>}</Drawer>
  <Modal title={preview?.upgrade?"审阅技能升级":"审阅技能包"} open={!!preview} width={850} okText="安装（默认禁用）" confirmLoading={busy} onCancel={()=>setPreview(undefined)} onOk={()=>action(async()=>{await call("studio.skill.install",{token:preview!.token});setPreview(undefined);})}>{preview&&<><Alert type="warning" title={preview.missingTools.length?`必需工具缺失或禁用：${preview.missingTools.join(", ")}。可以安装，补齐依赖后才能启用。`:"安装或升级后默认禁用；审阅说明后启用。已有会话保留原版本。"}/><Details skill={preview.definition}/></>}</Modal>
 </>;
}
