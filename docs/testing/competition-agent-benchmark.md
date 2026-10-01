# Agent Studio 真实 Benchmark

## v0.4.0 发行口径

本报告的实机实验已纳入 v0.4.0。发行审查新增关键路径防护、失败子 Agent 预算累计及结构化恢复数据脱敏；最终发行回归为 238 项单元测试、14 项 Electron 测试、typecheck 和 production build 通过。Risk 1.0.2 与写文件工具 1.0.1 的新防护经过本地回归，未重新生成实机 Benchmark；以下 Risk 1.0.1 的原始结果和历史“未打包或上传”状态保留追溯。正式发行与安装包核验以 [v0.4.0 发布验收](2026-10-01-v0.4.0-release.md) 为准。

## 最新可靠性增量（2026-10-01 晚）

增加每轮真实证据索引、锁定验收项状态和可引用ID指导；文件不存在使用严格{path,exists:false}。12例独立定向实验`e4249fb3-11d8-4933-a6ed-31e9600dc043`使用相同deepseek-flash模型，verify_file/update_plan1.1.0、RiskEngine1.0.1。只覆盖Compose、ExecStart故障、HTTP500与超时，不混入下文旧36例。

| 模式 | 成功/已评估 | 平均Agent步骤 | API总Token | 人工续接 | 误报成功 |
|---|---:|---:|---:|---:|---:|
| A | 2/4 | 17 | 845643 | 0 | 0 |
| B | 4/4 | 14 | 626436 | 0 | 0 |
| C | 4/4 | 14 | 635497 | 0 | 0 |

三组Compose与超时通过。A的ExecStart和HTTP500仍因声明的验收参数与实际产物不一致/收尾未通过而失败，完整记录保留。样本很小且模型随机，不能把这一轮解释为稳定优劣或全自动可靠性保证。

证据：[JSON](evidence/studio-20261001/benchmark-guidance.json)、[CSV](evidence/studio-20261001/benchmark-guidance.csv)、[Markdown](evidence/studio-20261001/benchmark-guidance.md)。

独立审查后将verify_file执行器修复为1.1.1：保留符号链接后的..实际语义；使用lstat且只接受FileNotFoundError为缺失，权限不足/其他查询异常不能判成功。5个真实Rocky边界例（缺失、已存在、悬空链接、符号链接父路径、nobody权限拒绝）通过，模型调用0，见[边界证据](evidence/studio-20261001/verifier-boundary-1.1.1.json)。这不是模型能力样本。

最终1.1.1版本新建三例超时实验`70720587-97fa-49cc-8d73-fac1fb382071`，A10步、B11步、C8步均自主完成终态核实，count.txt=1、result.json不存在、唯一持久Task达到预期超时终态，不重放脚本。每组只有一例；“核实任务完成”不表示work.sh业务工作成功。见[JSON](evidence/studio-20261001/benchmark-absence-final.json)、[CSV](evidence/studio-20261001/benchmark-absence-final.csv)、[汇总](evidence/studio-20261001/benchmark-absence-final.md)。最终231项单元测试、类型检查、build与14项Electron回归通过。本轮未打包或上传。

## 最新结果（2026-10-01）

充值后原实验完成23个可评估样本，另保留13个HTTP402阻塞样本；新隔离实验完整执行场景1–5的15个样本。统一选取新实验1–5和原实验6–12，得到36个非接口阻塞案例。选取规则对三组一致，旧1-A/1-B和所有阻塞、失败记录继续保留。模型均为deepseek-flash、Anthropic协议，RiskEngine1.0.1；这些数据产生于数字断言修复之前。

| 模式 | 成功/评估 | 成功率 | 恢复场景成功 | 平均Agent步骤 | 模型调用 | API总Token |
|---|---:|---:|---:|---:|---:|---:|
| A：通用Agent | 10/12 | 83.33% | 3/4 | 18.83 | 226 | 1970758 |
| B：SRE Skill | 8/12 | 66.67% | 3/4 | 18.17 | 219 | 1827671 |
| C：Studio组合 | 10/12 | 83.33% | 4/4 | 18.25 | 219 | 1881113 |

误报成功均为0。正式实验不替模型回答问题或批准操作；模型要求介入时记自主执行失败，因此“人工介入0”不等于所有案例成功。场景9、10、11三组均通过，执行计数均为1；场景12原A/B失败、C通过。A组平均耗时受超时场景等待拖长，完整逐例耗时可查原始文件。Workflow多次resume是调度续接事件，不能解读为40次软件重启。

样本每场景每模式只有一次，且经过充值后分批执行；不支持统计显著性或宣称Skill/Studio稳定优于通用Agent。发现的主要不足是计划证据ID引用、后置验收收尾、无必要的授权提问。已修复数字断言与短密码碰撞、计划允许不可执行的越界文件验收项，修复后新测试单独记录，不覆盖本表。

完整证据：[组合JSON](evidence/studio-20261001/benchmark-selected-36.json)、[组合CSV](evidence/studio-20261001/benchmark-selected-36.csv)、[组合汇总](evidence/studio-20261001/benchmark-selected-36.md)、[原实验完成导出](evidence/studio-20261001/benchmark-resumed.json)、[补测导出](evidence/studio-20261001/benchmark-retest.json)。下文余额阻塞表为充值前历史快照。

## 实验设计

在 Agent Studio → Benchmark 中选择已有 SSH 主机与模型 API，选择场景和 A/B/C 模式。同轮固定模型及主机配置摘要，配置变化拒绝继续。每个样本分配新的 `/opt/sre-benchmark/<UUID>/<场景>-<模式>`、systemd 服务名、Compose 项目名和端口。准备通过既有持久任务执行，引用落库后才继续；未知任务先核实，禁止重新提交。

模式 A 为通用 Agent、关闭 Skill；B 使用 SRE Skill 与持久计划；C 使用版本化 Agent Builder、Skill、Workflow、Risk、Verify 和恢复。全部保留平台权限及风险拦截，不能以降低 A/B 安全性制造差异。模型具有随机性，单轮结果不能证明统计显著性；导出保留模型、协议、版本和原始执行证据。

场景：Python Web、systemd、Compose 部署；ExecStart 错误、停止服务、端口冲突、HTTP 500、JSON 语法错误修复；单次 SSH 查询连接中断、连续查询失败、后台进程实际重启、长任务超时核实。

恢复场景脚本每次启动递增计数，无隐藏幂等保护。独立检查要求计数恰好 1；超时场景还要求没有完成文件。故障注入仅匹配当前样本的持久任务查询。SSH 中断会结束该次真实连接；连续查询失败为客户端查询错误注入，不声称断开整台主机网络。后台重启需勾选开关，落盘后实际重新启动应用，回来点击继续实验。没有注入成功的样本不能记作恢复成功。

## 指标与证据

成功须同时满足执行状态完成、独立 SSH 验证通过、要求的故障实际注入。模型声称完成但独立验证失败单独记为误报。未执行、准备失败不计入成功率分母；页面同时显示总数、已评估数及准备失败数，不能隐藏缺样。

记录真实 Tool/Model 调用、失败、审批、人工介入、风险阻断、验证失败、恢复继续、耗时以及接口返回 token。缺失用量为 null，禁止估算。JSON 包含完整 Trace、故障时间/Task ID和独立验证输出；CSV 为逐案例结果；Markdown 为分组汇总。导出再次脱敏。

需要审批/用户输入时实验暂停，在 AI 助手或 Workflows 处理后继续；不会绕过 Risk 自动批准。暂停调度不撤销当前远端作业。停止保留测试资源和证据，不清理既有业务。根目录、服务名和端口生成在后端，准备前拒绝覆盖已有同名资源。

## 当前验证状态

七模块已实现并取得上方真实结果。仍需持续改进模型证据收尾可靠性；历史调试过程和未通过样本保留如下。

### 统计口径补充

Mean Completion Time为样本从隔离环境准备到独立验收结束的实际耗时，包含准备和故障等待；Trace.elapsedMs另外保留执行器自身耗时。Mean Agent Steps只统计Agent的计划、工具或文字决策步骤，不把C组的Workflow节点调度额外混入Agent步骤。Resume Success Rate以实际继续事件为分母，只在最终完成时计为成功；没有继续事件时为null。后台重启通过进程退出与重启实测，客户端查询错误注入与真实SSH连接中断分别记录，不能混称为服务器宕机。

### 2026-10-01 实机调试与统一版本实验
2026-09-30探索运行中，Python Web与systemd三模式均通过；Compose B组暴露/dev/null诊断误拦截。已修复RiskEngine至1.0.1，保留设备修改阻断。探索结果不作为统一版本优劣比较。随后新建18300起端口、12×3样本实验。自主计分模式遇到外部输入/审批需求时停止该样本并记失败，不自动授权，不伪造成功。正式结果待实际完成后追加。

## 已取得的真实结果（2026-10-01）

### 探索性部署

实验 `03b10f3f-9690-4692-9638-247262db6f25` 的 Python Web 部署：

| 模式 | 已评估/通过 | 实际耗时 | Agent步骤 | 模型调用 | API返回总Token |
|---|---:|---:|---:|---:|---:|
| A | 1/1 | 45.761秒 | 14 | 14 | 113650 |
| B | 1/1 | 82.153秒 | 31 | 31 | 341312 |
| C | 1/1 | 58.015秒 | 20 | 20 | 188191 |

三者均以独立SSH HTTP200及正文检查确认，人工审批0、误报成功0。只有各一例，不支持优劣或统计显著性结论。实际结果在 [JSON](evidence/studio-20261001/exploratory-deployment.json)、[CSV](evidence/studio-20261001/exploratory-deployment.csv)、[Markdown](evidence/studio-20261001/exploratory-deployment.md)。

随后探索实验 `c9e1ae84-65f0-481f-8c36-15b1917eade5` 的systemd A/B/C及Compose A通过；Compose B的容器unhealthy与诊断误拦截保留现场。此轮在调试期间结束，不混入固定版本正式比较。见 [该轮原始结果](evidence/studio-20261001/exploratory-systemd-compose.json)。

### 统一版本实验被接口余额阻断

实验 `837b5877-dd94-445b-93dd-69cc5e0bff4b` 使用deepseek-flash、Anthropic协议、RiskEngine1.0.1，总计划36例。目前：

| 模式 | 已评估 | 通过 | 接口阻塞 | 待执行/准备 |
|---|---:|---:|---:|---:|
| A | 1 | 0 | 4 | 7 |
| B | 1 | 1 | 4 | 7 |
| C | 0 | 0 | 5 | 7 |

A样本虽然HTTP检查可通过，但计划证据引用反复失败，最终要求外部介入，按自主执行未完成计分；没有人为改成成功。B样本完成了部署及独立验收。随后接口连续HTTP402，DeepSeek官方将其定义为 [Insufficient Balance](https://api-docs.deepseek.com/quick_start/error_codes/)。已停止测试后端，保存原数据库备份，并将13项接口故障单列；previousOutcome保留分类前状态，不能将缺额样本当作算法失败或成功。新代码首次遇到模型HTTP错误即暂停整轮。

数据不足，**尚不能形成三组完整效果比较或恢复成功率**。见 [部分原始JSON](evidence/studio-20261001/benchmark-partial.json)、[CSV](evidence/studio-20261001/benchmark-partial.csv)、[Markdown](evidence/studio-20261001/benchmark-partial.md)。补充余额后继续核实原Task，尚未执行的案例可继续；已接口阻塞的案例需要另建隔离样本补测，禁止重复提交原未知变更。

### 无模型依赖的受控包与Workflow实机验证

新安装并启用web-health Tool与web-healing Skill，使用独立HTTP500服务。Workflow实际完成：Approval → Tool → Condition → Output → Verify → End。工具输出healthy=false/status=500，Condition实际命中true分支，内置verify_file核实JSON配置含500。记录有1次具体工具操作审批、实际Task ID、Risk和版本，模型调用为0。

见 [结果](evidence/studio-20261001/controlled-tool-result.json) 和 [完整Trace](evidence/studio-20261001/controlled-tool-workflow.json)。该测试证明扩展包与真实执行/分支/审批链路，**不代表模型自主修复HTTP500**。

## 充值前待办记录（后续结果见最新章节）

- 统一版本36个样本完整实测及重复实验。
- 竞赛版Agent/Workflow组合的SSH中断、后台重启、长任务超时实机验证（旧v0.3.0恢复实测不能代替新版）。
- 三个完整实机Demo：自定义自愈Agent、Compose配置故障修复、Agent持久任务恢复。示例包和运行脚本已准备，等待模型账户可用。
- 本轮未打包或发布新版本。新增测试资源保留，旧监控和业务不清理。

## 充值后的实机续测与演示

用户充值后，provider.test真实请求成功；原实验从6-A检查点继续并完成，未重跑13个接口阻塞样本。另建实验`fc18c453-26c1-43f5-b3bc-4f6105ab226c`，使用18500起新端口，对1–5场景三组一起补测完成，旧结果完整保留。

### Demo 1：Web故障自愈已通过

自定义健康Tool经过一次具体审批，发现HTTP500；Condition进入诊断分支，加载Linux/Web Skill，由Builder配置的Agent执行16步，备份并修复配置、重启指定服务，Workflow Verify及额外SSH检查均确认active、HTTP200与benchmark-ready。修复过程无需人工续接。实际服务端口18230。

证据：[Trace](evidence/studio-20261001/demo1-e000f858-be6a-464e-93f7-7a181fd92ff7.json)、[独立验收](evidence/studio-20261001/demo1-result.json)。

### Demo 2：Compose部署和修复已通过，含一次续接

实际Agent部署了18700回环端口nginx:alpine博客；随后只对该隔离项目注入非法Nginx启动command并保存备份。修复Agent定位原因并写回正确配置后询问是否允许读取文件，首轮停在awaiting_input。通过正式核实、reply与resume接口补充已有授权说明后，21步完成，独立Compose config和HTTP验收通过。因此不能将修复描述为全程自主成功，人工续接次数为1。

证据：[部署](evidence/studio-20261001/compose-demo-deploy-result.json)、[故障注入](evidence/studio-20261001/compose-demo-fault-injection.json)、[首次停顿](evidence/studio-20261001/compose-demo-repair-result.json)、[续接验收](evidence/studio-20261001/compose-demo-repair-resumed-result.json)。同目录保留各阶段完整Trace。旧业务未清理，尚未上传发布。

### Demo 3：Agent持久任务在后台重启后恢复已通过

原实验11-C的Builder+Workflow子Agent启动隔离work.sh后，测试后台真实退出并重新启动（PID30344→29308）。软件重新读取检查点、核实原Task、继续Agent和Workflow，独立验证count.txt=1、result.json为ready/count=1，绑定的持久Task只有一个且succeeded/exitCode=0。没有重新执行脚本。属于真实后台进程重启，尚未覆盖Windows重启或完整Electron主窗口重开。

证据：[完整Trace](evidence/studio-20261001/demo3-restart-trace.json)、[故障注入与独立验收](evidence/studio-20261001/demo3-restart-result.json)。此外9-C真实查询连接断开、10-C六次查询错误均通过；这两类故障不能称为整台服务器掉线。

### 数字断言修复后的独立超时复测

新实验`8581a94b-fb94-452e-a20c-262e6a9dc16c`使用18800起端口，各模式重新创建隔离资源。A14步、C11步自主完成，独立执行计数均为1；B19步未完成。B的expectText="1"实际验收已成功，剩余阻碍是模型把不存在的result.json声明为verify_file检查对象，minBytes=0仍要求文件存在。平台没有降低已锁定checks来伪造成功，B原始失败保留。此复测证明数字误脱敏修复有效，不代表所有超时任务都能自主收尾，也不覆盖上方36样本统计。

证据：[JSON](evidence/studio-20261001/benchmark-timeout-fix.json)、[CSV](evidence/studio-20261001/benchmark-timeout-fix.csv)、[汇总](evidence/studio-20261001/benchmark-timeout-fix.md)。最终本地225项单元测试、类型检查及生产构建通过，界面回归结果见根目录进程记录。未打包上传。
