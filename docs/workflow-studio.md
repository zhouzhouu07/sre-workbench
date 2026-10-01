# Workflow Studio

入口：Agent Studio → Workflows。提供Web服务故障自愈、应用部署两个真实定义模板，运行前为引用的Agent模板绑定模型。图编辑器使用现有React/SVG，无额外第三方图依赖。左侧添加节点，中央拖动画布节点，右侧编辑属性和连接，顶部验证、保存、克隆、运行；运行使用已保存版本。

## 节点与映射

支持Start、Input、Agent、Skill、Tool、Condition、Approval、Verify、Retry、Wait、Output、End。属性JSON修改后点“应用节点配置”，再保存流程。next表示正常下一步，Condition以next/otherwise表示true/false；onFailure表示已确认失败分支。

- Tool：tool和arguments；可设timeout秒（1–1800），参数走原Tool验证和权限检查。命令经原Task执行，不直接起SSH shell。
- Agent：agentId与instruction，调用固定的Agent配置快照；审批或补充信息在AI助手中处理，然后继续工作流。Skill节点把固定技能快照加入后续Agent，依赖必须包含在其工具白名单。
- 输入映射：文字、数字、对象等字面值，或独立对象`{"$ref":"input.url"}`、`{"$ref":"outputs.status.stdout"}`。不执行表达式或任意JS。引用不存在时明确失败。
- Condition：left、op、right；op支持eq/ne/gt/gte/lt/lte/contains/exists。数字比较拒绝隐式类型转换。contains只比较字符串。
- Approval：toolNodeId必须为直接连接的Tool节点。审批绑定运行ID、节点、参数、目标、权限、工具摘要和风险，批准内容变化会被拒绝。重启使未消费审批失效，必须重新审批。
- Verify：只允许内置独立验收工具，例如verify_service/http_check/verify_file/verify_package/compose_check；自定义工具不得自封验收。
- Retry：retryTarget只能是通过onFailure直接到达该Retry的Tool/Verify，maxRetries为1–3，backoff为0–60秒，指数退避上限60秒。未知结果不能重试；重试不会回放整条流程。变更失败可能已有部分效果，配置Retry前应审查工具幂等性。
- Wait：0–300秒，落盘dueAt，恢复后不会重新计算完整等待时长。
- Input：required字段列表，缺失时暂停，补充只接受缺失字段，不允许改写此前输入或审批参数。
- Output保存映射结果。End拒绝遗留失败/未知节点；发生变更后必须有更新的Verify才能成功结束。

## 校验和恢复

保存检查唯一Start、至少一个End、节点ID唯一、连接存在、全部节点可达、普通连接无环、工具/技能/Agent存在、Verify资格、Retry上限和直接失败关系；拒绝原型字段、过深映射和不存在的输出节点。带默认工作流的Agent不能作为子Agent递归调用。

开始时固定Workflow、Tool、Skill和Agent版本，记录目标身份、截止时间及输入。每次提交前后保存节点状态、Task ID、子Agent会话ID、输出、审批及事件。应用重启后正在执行的流程变成待核实，不自动提交。核实只查询原作业：仍运行/断线则保留待核实；确认结果后同步检查点，人工继续。已经成功的节点不会重放。没有可核实作业引用的中断变更保留现场并拒绝盲目恢复。

暂停在当前节点边界生效；停止不等于撤销远端变更。子Agent等待审批/输入时工作流同步等待，工作流停止时要求子Agent暂停并保留待核实状态。运行有300次节点调度上限和默认1小时截止时间；绑定父Agent时采用其更小范围、预算和权限。

执行记录显示节点状态、时间、任务引用、输出和审批。只存结构化决策摘要，不记录隐藏思维链。普通流程不需要模型；Agent节点才使用已配置模型API。所有真实服务器变更需依照用户任务权限执行。
