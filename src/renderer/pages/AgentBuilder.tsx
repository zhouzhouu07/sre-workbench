import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { call, reportError } from "../api";
import type { AgentDefinition, ToolDefinition, SkillDefinition } from "../../shared/studio";
import type { AgentSession } from "../../shared/agent";
import { permissionLabels } from "../../shared/agent";
import type { Snapshot } from "../../shared/types";
export default function AgentBuilder(){
 const [rows,setRows]=useState<AgentDefinition[]>([]),[tools,setTools]=useState<ToolDefinition[]>([]),[skills,setSkills]=useState<SkillDefinition[]>([]),[data,setData]=useState<Snapshot>();
 const [editing,setEditing]=useState<AgentDefinition|null>(),[running,setRunning]=useState<AgentDefinition>(),[busy,setBusy]=useState(false),[result,setResult]=useState("");
 const [form]=Form.useForm(),[runForm]=Form.useForm();
 const load=useCallback(async()=>{const [a,t,s,d]=await Promise.all([call<AgentDefinition[]>("studio.agent.list"),call<ToolDefinition[]>("studio.tool.list"),call<SkillDefinition[]>("studio.skill.list"),call<Snapshot>("snapshot")]);setRows(a);setTools(t);setSkills(s);setData(d);},[]);
 useEffect(()=>{void load().catch(reportError);},[load]);
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn();await load();}catch(e){reportError(e);}finally{setBusy(false);}};
 const edit=(a:AgentDefinition|null)=>{form.resetFields();form.setFieldsValue(a?{...a,acceptanceCriteria:a.acceptanceCriteria.join("\n")}: {name:"",description:"",icon:"🛠",category:"SRE",providerId:"",permissionCeiling:"readonly",riskPolicy:"balanced",toolIds:tools.filter(t=>t.enabled&&t.permissionRequirement!=="mutation").map(t=>t.id),skillIds:[],maxSteps:40,maxRuntimeSeconds:1800,targetHostIds:[],rootPrefix:"/",acceptanceCriteria:"报告引用真实证据；变更后独立验收",enabled:true});setEditing(a);};
 const selectTools=tools.map(t=>({value:t.id,label:`${t.name} · ${t.id}${t.enabled?"":"（禁用）"}`}));
 return <>
  <Card style={{marginBottom:16}}><Space wrap style={{width:"100%",justifyContent:"space-between"}}><div><Typography.Title level={3}>Agent Builder · 构建运维助手</Typography.Title><Typography.Text type="secondary">版本化配置 · 工具白名单 · 技能快照 · 目标与权限约束</Typography.Text></div><Space><Button onClick={()=>action(()=>call("studio.agent.import"))}>导入 Agent</Button><Button type="primary" onClick={()=>edit(null)}>新建 Agent</Button></Space></Space></Card>
  {result&&<Alert type="success" showIcon closable onClose={()=>setResult("")} title={result} style={{marginBottom:16}}/>}
  <Table<AgentDefinition> rowKey="id" dataSource={rows} pagination={{pageSize:8}} scroll={{x:1100}} columns={[
   {title:"Agent",key:"name",render:(_,a)=><><strong>{a.icon} {a.name}</strong><div className="muted">{a.description}</div></>},
   {title:"版本",dataIndex:"version"},{title:"分类",dataIndex:"category"},
   {title:"权限上限",key:"permission",render:(_,a)=>permissionLabels[a.permissionCeiling]},
   {title:"能力",key:"abilities",render:(_,a)=><>{a.toolIds.length} Tools / {a.skillIds.length} Skills<br/><Tag>{a.riskPolicy}</Tag></>},
   {title:"启用",key:"enabled",render:(_,a)=><Switch aria-label={`启用Agent ${a.id}`} disabled={busy} checked={a.enabled} onChange={enabled=>action(()=>call("studio.agent.enable",{id:a.id,enabled}))}/>},
   {title:"操作",key:"actions",render:(_,a)=><Space wrap><Button onClick={()=>edit(a)}>编辑</Button><Button onClick={()=>action(()=>call("studio.agent.clone",{id:a.id}))}>克隆</Button><Button onClick={()=>action(()=>call("studio.agent.export",{id:a.id}))}>导出</Button><Button type="primary" disabled={!a.enabled||busy} onClick={()=>{runForm.resetFields();runForm.setFieldsValue({permission:a.permissionCeiling,root:a.rootPrefix,sudo:false});setRunning(a);}}>运行</Button>{a.source==="custom"&&<Button danger onClick={()=>Modal.confirm({title:`删除 ${a.name}？`,content:"历史运行快照保留。",onOk:()=>action(()=>call("studio.agent.remove",{id:a.id}))})}>删除</Button>}</Space>},
  ]}/>
  <Modal title={editing?`编辑 ${editing.name} · ${editing.version}`:"新建 Agent"} open={editing!==undefined} width={940} confirmLoading={busy} okText="保存 Agent" onCancel={()=>setEditing(undefined)} onOk={()=>action(async()=>{const values=await form.validateFields();await call("studio.agent.save",{...values,...(editing?{id:editing.id,expectedDigest:editing.digest}:{}),workflowId:values.workflowId?.trim()||undefined,acceptanceCriteria:String(values.acceptanceCriteria).split("\n").map(v=>v.trim()).filter(Boolean)});setEditing(undefined);})}>
   <Form form={form} layout="vertical"><Row gutter={16}>
    <Col span={12}><Form.Item name="name" label="名称" rules={[{required:true}]}><Input/></Form.Item></Col><Col span={6}><Form.Item name="icon" label="图标"><Input/></Form.Item></Col><Col span={6}><Form.Item name="category" label="分类" rules={[{required:true}]}><Input/></Form.Item></Col>
    <Col span={24}><Form.Item name="description" label="描述"><Input.TextArea rows={2}/></Form.Item></Col>
    <Col span={12}><Form.Item name="providerId" label="已有模型配置"><Select options={[{value:"",label:"暂不绑定（运行前必须绑定）"},...(data?.providers.filter(p=>p.kind==="model").map(p=>({value:p.id,label:p.name}))??[])]}/></Form.Item></Col>
    <Col span={6}><Form.Item name="permissionCeiling" label="权限上限"><Select options={Object.entries(permissionLabels).map(([value,label])=>({value,label}))}/></Form.Item></Col>
    <Col span={6}><Form.Item name="riskPolicy" label="风险策略"><Select options={[{value:"cautious",label:"谨慎：所有变更审批"},{value:"balanced",label:"均衡：高风险审批"},{value:"autonomous",label:"自主：遵守权限上限"}]}/></Form.Item></Col>
    <Col span={24}><Form.Item name="toolIds" label="Tool 白名单"><Select mode="multiple" options={selectTools}/></Form.Item></Col>
    <Col span={24}><Form.Item name="skillIds" label="Skill 绑定"><Select mode="multiple" maxCount={8} options={skills.map(s=>({value:s.id,label:`${s.name} v${s.version}`}))}/></Form.Item></Col>
    <Col span={12}><Form.Item name="targetHostIds" label="允许的服务器（空为全部已验证服务器）"><Select mode="multiple" options={data?.hosts.map(h=>({value:h.id,label:h.name}))}/></Form.Item></Col><Col span={12}><Form.Item name="rootPrefix" label="允许的任务工作目录前缀" extra="限制任务入口目录；终端按服务器账号权限执行，不是命令沙箱。" rules={[{required:true}]}><Input/></Form.Item></Col>
    <Col span={8}><Form.Item name="maxSteps" label="每轮步骤上限"><InputNumber min={1} max={100}/></Form.Item></Col><Col span={8}><Form.Item name="maxRuntimeSeconds" label="最大运行时间（秒，含暂停）"><InputNumber min={30} max={86400}/></Form.Item></Col><Col span={8}><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch/></Form.Item></Col>
    <Col span={24}><Form.Item name="workflowId" label="默认Workflow ID" extra="绑定后运行完整工作流，父Agent的目标、权限和工具白名单继续生效。"><Input allowClear/></Form.Item></Col>
    <Col span={24}><Form.Item name="acceptanceCriteria" label="默认验收标准（每行一项）" rules={[{required:true}]}><Input.TextArea rows={3}/></Form.Item></Col>
   </Row></Form>
  </Modal>
  <Modal title={running?`运行 ${running.name}`:"运行 Agent"} open={!!running} okText="启动任务" confirmLoading={busy} onCancel={()=>setRunning(undefined)} onOk={()=>action(async()=>{const v=await runForm.validateFields();await call("studio.agent.run",{id:running!.id,instruction:v.instruction,permission:v.permission,target:{kind:"ssh",hostId:v.hostId,root:v.root,sudo:v.sudo}});setResult(`任务已创建：${running!.name}。在${running!.workflowId?"Workflows执行记录":"AI助手"}中查看输出、审批、暂停或继续。`);setRunning(undefined);})}>
   <Alert type="info" title="启动时固定Agent、Skill、Tool版本和目标。后续编辑不改变本次任务。"/>
   <Form form={runForm} layout="vertical"><Form.Item name="hostId" label="远程服务器" rules={[{required:true}]}><Select options={data?.hosts.filter(h=>h.fingerprint&&(!running?.targetHostIds.length||running.targetHostIds.includes(h.id))).map(h=>({value:h.id,label:h.name}))}/></Form.Item><Form.Item name="root" label="任务目录" rules={[{required:true}]}><Input/></Form.Item><Form.Item name="permission" label="本次权限"><Select options={Object.entries(permissionLabels).slice(0,Object.keys(permissionLabels).indexOf(running?.permissionCeiling??"readonly")+1).map(([value,label])=>({value,label}))}/></Form.Item><Form.Item name="sudo" label="允许已配置sudo" valuePropName="checked"><Switch/></Form.Item><Form.Item name="instruction" label="本次需求" rules={[{required:true}]}><Input.TextArea rows={4}/></Form.Item></Form>
  </Modal>
 </>;
}
