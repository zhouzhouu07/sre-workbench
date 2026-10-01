# SRE Agent Studio 竞赛版实施架构

v0.4.0 竞赛版，基于 v0.3.0 平台扩展；七模块及可靠性增强已完成。2026-10-01 用户授权本轮正式发行，结果以 [发行说明](releases/v0.4.0.md) 和 [最新交接](next-session-handoff.md) 为准。以下实施过程保留各模块验收数量。

## 基线与实施原则

Electron主进程在受信IPC中分发Backend、AIService、AgentService。SQLite以records(collection,id,data)存JSON，新增集合即可兼容旧数据；凭据仍在加密secrets表。TaskManager负责SSH上的持久systemd作业、退出码、退避查询与恢复。现有21个工具的Zod参数契约、AgentTools执行器、四档权限、计划、独立后置验收与历史记录继续保留。

模块严格串行：完整数据结构→后端→存储→IPC→UI→兼容→文档→集中模块测试和完整回归。测试发现的问题修复后再回归；不采用零碎TDD流程。每个模块通过后才进入下一模块，不用未测试结果填报告。

## 模块依赖与实现路线

1. Tool Registry / Tool Center：统一元数据、输入契约、路由、启停、版本、调用记录。Agent仅通过Registry路由到原执行器。受控本地目录包支持Remote Script与固定回环HTTP；不动态加载Node代码。导入先预览、后安装，默认禁用，必须显式启用。脚本参数以JSON环境变量传递，不拼接为shell代码；全部自定义工具视作潜在变更，走已有权限和持久Task。初期风险下限保护由Registry执行，完整策略在MODULE5扩展。
2. Skill Registry / Skill Center：结构化依赖、限制、风险提示与验收，安装/升级和依赖提示，运行快照独立于可编辑定义。
3. Agent Builder：可版本化定义与模板，模型只引用已有配置；运行固定目标、权限上限、Tool/Skill版本及策略快照，复用现有AgentService循环。
4. Workflow：图编辑器和持久串行节点解释器，安全结构化条件、真实审批、有限Retry/Wait，节点结果/Evidence/Task引用可恢复。已完成变更不得重放。调用既有Agent/Registry，不另造远端执行器。
5. Risk Engine：集中规则评分和解释，由后端强制与既有权限取交集；模型不能更改策略、主机或权限。
6. Trace / Versioning：统一结构化时间线和JSON/Markdown导出，只记录决策摘要和执行证据，不保存隐藏思维链。
7. Benchmark：隔离场景、三组可比配置、真实采集与JSON/CSV/Markdown输出；最后实机端到端验收。

## MODULE1设计

- 新增tools、toolUsage存储集合，不改旧表；默认内置启用，旧会话仍读取原字段。内置工具不可卸载；禁用阻止后续调用，不撤销已经执行的作业。
- 新增ToolDefinition、ToolPackage、ToolUsage以及工具版本摘要。Schema v1采用有界JSON Schema子集，拒绝未知关键字、外部引用、原型键和过深结构；内置仍使用原Zod执行校验。
- 主进程ToolRegistry统一get/list/register/unregister/enable/disable/version/validate/execute，检查版本、目标、权限及风险下限，再调用AgentTools；计划元工具保留AgentService的证据与checks锁定逻辑。
- 本地包由用户选择目录，固定manifest.json及README.md，脚本文件限包内普通文件，拒绝路径穿越、符号链接和超限内容。导入预览摘要，安装使用主进程缓存的内容与一次性令牌，避免预览后文件变更。导入内容不得包含已知凭据。HTTP v1从选定SSH服务器访问固定回环HTTP GET，不允许任意外部地址、重定向或包内认证。
- 所有导入工具至少为变更权限，不能用包声明readonly绕过；高风险导入操作要求确认，critical拒绝。运行版本与摘要固定，审批等待后再核对，禁用或卸载立即阻断新调用。
- UI沿用现有AntD与配色，新增Agent Studio导航和工具页；包含分类/来源筛选、元数据、Schema、README、启停、导入预览/安装/卸载以及最近使用记录。后续模块通过验收后再增加各页，不创建虚假功能入口。

## 当前状态

- MODULE1：本地验收通过，176项单元测试、9项Electron回归、typecheck与build通过。实机包执行在最终实机阶段验证。
- MODULE2：通过181项单元测试、10项Electron回归、typecheck与build。
- MODULE3：通过186项单元测试、11项Electron回归、typecheck与build。
- MODULE4：通过198项单元测试、12项Electron回归、typecheck与build。
- MODULE5：通过206项单元测试、12项Electron回归、typecheck与build。
- MODULE6：通过211项单元测试、13项Electron回归、typecheck与build。
- MODULE7：前后端与本轮实机验收完成，36个非接口阻塞案例及三个Demo证据见实验报告；原HTTP402和自主执行失败全部保留。七模块验收后继续增强证据引用和文件不存在断言，本轮最新231项单元测试通过，完成12例独立定向实测及最终3例超时实测，不覆盖旧得分。

## 完整运行架构

| 层 | 职责 | 持久数据 |
|---|---|---|
| Tool Registry | 统一21项内置工具及受控包，Schema/版本/启用/权限校验，SSH执行 | tools、toolUsage、tasks |
| Skill Registry | 结构化说明、依赖、约束和验收；安装/升级预览 | skills、运行快照 |
| Agent Builder | 模型引用、白名单、目标、权限上限、策略和执行预算 | agents、aiSessions |
| Workflow | 12类节点、结构化条件、有限重试、真实审批和检查点恢复 | workflows、workflowRuns |
| Risk Engine | 规则评分、因素解释，与原权限取交集；CRITICAL拒绝 | Step/Node风险快照 |
| Execution Trace | 聚合模型、计划、工具、审批、恢复和验证证据 | modelUsage及原始运行记录 |
| Benchmark | 12场景隔离夹具、A/B/C、定向故障注入、独立验收与导出 | benchmarkRuns及完整Trace |

所有执行最终进入既有AgentTools/TaskManager，不在Windows主进程加载第三方脚本。模型不能在工具参数中改变目标、权限或风险策略。工作目录用于文件工具约束，不是终端命令沙箱；规则型风险评分也不等同于操作系统隔离。

v0.4.0发行审查补齐：Risk1.0.2按工作目录解析路径，文件变更执行器realpath后再次拒绝关键系统路径；write_file／make_directory1.0.1。子Agent成功／失败／取消均累计父级工具预算，已累计标记随检查点落库；恢复导入工具数据逐字段脱敏，结构保持与正常调用一致。原实机得分版本与发行修复分开记录。

恢复以已存Task ID和退出证据为准。等待审批但尚未提交的节点可以重启后重新审批；已提交但未知的节点必须先核实。没有Task引用且不能证明未执行的变更拒绝重放。导入工具的恢复结果重新校验固定版本Schema，并保留与正常执行一致的data映射。

Benchmark恢复场景由脚本实际打印唯一执行标记，再将所在会话的Task ID绑定到样本。查看脚本的观测任务不计为执行，不触发故障注入。独立验收结合远端计数、唯一执行Task和终态，防止重复执行被幂等脚本掩盖。

## 产品与演示边界

本轮支持SSH Linux运维，不新增Windows本机执行入口、Kubernetes、CMDB、多租户或分布式调度。第三方Skill是受约束上下文，不能提高权限；第三方Tool仍需具体操作审批。未提供的模型token用量保留null。

v0.4.0 安装包构建配置包含 Studio 使用文档、示例包及脱敏实验材料；v0.3.0 及更早安装包不含七模块。发布严格经过完整回归、只读审查、打包程序实际启动、附件摘要和公开下载验证。

## 自主执行可靠性增量

verify_file 1.1.1支持严格{path,exists:false}，以词法范围、保留符号链接父路径语义的realpath及lstat检查不存在条件，只接受FileNotFoundError为缺失，权限或其他元数据查询异常失败，拒绝悬空链接、目录链接逃逸和混用内容断言。默认普通文件验收沿用旧参数；update_plan因检查Schema升级到1.1.0。历史运行的版本摘要仍固定，工具升级后禁止悄悄切换执行器。

Agent每轮executionGuidance包含真实成功非计划工具ID索引、最后变更ID、各锁定检查参数及最近执行状态。verificationIds调用与finish相同的completionEvidence和服务验收判断，仅是可引用证据建议，不能自动宣布任务完成。旧于最后变更的检查不合格，最新同参数检查失败也不能拿旧成功覆盖，服务/HTTP要求继续存在。所有功能由后端实现，Builder/Workflow子Agent共享能力。
