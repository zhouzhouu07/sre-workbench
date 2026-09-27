# 分类验收开发与测试（2026-09-22，未发布）

## 解决的问题

此前执行过任意run_command的任务必须有后置服务/HTTP验收，导致无服务的批处理、安装包与文件任务难以完成。新计划可声明文件/安装包checks，按实际结果逐项验证。旧会话无checks时保留原完成要求。

## 行为与边界

- 新增verify_file、verify_package，共21工具；两者仅SSH Linux，属于只读工具，advice禁止、readonly允许。
- checks必须在首次实际变更前保存；变更开始后不能新增、删减或替换条件，更新计划必须保留原checks。暂停续接不清除此约束。
- 最后变更后，必须使用相同工具和参数执行每项检查，全部成功并在finish中引用。若同一检查后来失败，不能引用此前成功掩盖失败。
- 实际service_action/compose_action或识别到的服务需求仍要求额外服务/HTTP验证；自然语言需求识别是保守启发式，不等于理解所有shell副作用。检查项是否覆盖完整业务仍须审阅，不能靠模型声明保证全部需求。
- 文件工具使用真实路径限制任务根目录，拒绝非普通文件，最多1MiB。默认要求至少1字节，可检查正文包含、SHA256、八进制权限、UTF-8、JSON或Python语法。Python只ast解析，不执行目标文件，不验证import依赖或运行结果。依赖/usr/bin/python3。
- JSON拒绝NaN/Infinity非标准常量；不等同JSON Schema字段校验。文件检查不是备份恢复演练，SHA256也只证明匹配指定摘要。
- 包工具查询RPM/DEB数据库，支持可选精确版本；RPM比较VERSION、不含RELEASE，DEB比较完整Version。包存在不证明程序可用；不覆盖pip/npm、源码安装。
- 计划面板显示具体文件、格式、正文/摘要/权限和包版本条件。

## 测试过程

初次连接虚拟机无法取得SSH指纹，没有执行远端变更；用户确认开机后重连，指纹一致。通过实际Backend/AgentService/AIService及DeepSeek执行隔离任务。

任务：在 `/opt/sre-agent-acceptance-20260922` 运行Python批处理，生成含platform、generated_at、status=ready的summary.json，使用已有Python，不搭建HTTP服务，不改变其他服务。

Agent11条记录完成：预检、带checks的计划、创建目录、生成脚本、运行命令、verify_file、verify_package、计划更新及交付。未要求人工续接，未启动新服务。RPM返回python3 3.9.18，生成报告187字节、权限0644；独立Python解析检查具体字段，原18086博客仍正常。

8项实机工具检查：正常JSON与包查询成功；错误文本、全零摘要、错误权限、路径越界、缺失包、错误版本均失败。

另6项Linux边界检查：非法JSON失败；包含raise语句但语法正确的Python验收成功（证明未执行代码）；非法Python失败；指向/etc/passwd的越界符号链接失败；FIFO非阻塞拒绝；超过1MiB文件拒绝。样本保留在测试目录verifier-fixtures中，无敏感文件内容输出。

本地真实Python文件测试另覆盖缺失文件、目录、Windows junction越界、NaN拒绝。DEB状态/版本路径采用模拟返回验证，未在Debian主机实测；Linux实机为RPM。首轮Electron回归因旧测试仍写巡检技能1.0.0失败，更新为上轮已实现1.0.1后7项通过。计划展开截图已检查，具体条件可见，无页面JS异常。

新增会话回归验证：shell文件任务可完成、变更后修改checks被拒；执行过service_action后仅文件验收不能完成。证据匹配测试覆盖部分缺失、参数不符、后续失败与服务验收不可替代。

## 交付状态

修改保留本地，不打包、不提交或推送。源码测试记录在项目进程.md，原始实机记录在Git忽略的.tools/autonomous-live-20260921中，文件名含typed与20260922。凭据不写入项目文档或Git。

主机本次重启后只观察到原18086博客自动运行，之前18087/18088未设置自启，本轮未启动它们。分类验收不等于完整恢复机制；断线/长任务恢复、Docker/Compose实测仍是后续工作。

最终验证：15个测试文件共158项单元测试、类型检查、生产构建通过；7项Electron交互测试通过，Git差异检查无错误。构建保留既有大chunk提示。
