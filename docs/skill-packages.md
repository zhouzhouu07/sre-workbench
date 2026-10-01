# 技能包与Skill Center

入口：Agent Studio → Skills。内置4项SRE技能已通过统一Registry提供，支持禁用；自定义技能支持安装、升级、启用、禁用、删除及依赖检查。技能是执行方法和验收建议，不是可绕过权限的程序。

包目录固定包含manifest.json、instructions.md、README.md。manifest参考examples/skill-packages/web-diagnosis，所有字段必需：id（custom.前缀）、name、version（三段数值）、description、triggers、requiredTools、optionalTools、constraints、riskHints、acceptanceCriteria。不支持额外字段、脚本执行和外部文件引用。文件限制分别32KB、60KB、20KB；拒绝符号链接、已知凭据及空执行说明。Tool依赖不得重复。

通过原生目录选择器预览，安装使用缓存内容，十分钟过期。升级必须高于当前版本；并发预览导致当前版本变化时拒绝覆盖。安装和升级都默认禁用，缺少或禁用必需Tool时不能启用，列表显示具体依赖。

AI助手支持自动匹配原内置技能，或通过“指定技能包”选择最多8项。显式选择优先于自动匹配；新任务检查依赖可用性。运行保存skillId/skillVersion/instructionsSnapshot/toolDependencies/acceptanceSnapshot，以及风险提示和约束。既有任务不会读取后来升级的说明，删除技能不会删除历史快照。Tool禁用仍然阻止下一次执行，不会因Skill快照而绕过。

旧会话仅含id/name/version/instructions时仍按原说明继续。内置自动匹配遇到禁用或缺依赖技能时使用通用Agent；显式选择不可用技能则拒绝启动。Skill验收是补充建议，不能替代平台独立验收或降低权限要求。
