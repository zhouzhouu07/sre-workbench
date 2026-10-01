# Tool Center与受控工具包v1

入口：Agent Studio → Tools。内置21工具保留原名称、参数、权限与执行器。可以查看Schema、版本、目标、基础风险和最近使用，内置工具可禁用但不能卸载。已开始的远端任务不因禁用而撤销；新调用和审批后的实际执行会重新检查启用状态与版本。

## 导入与运行

1. 选择本地包目录（manifest.json、README.md以及可选脚本）。固定文件读取限额：manifest32KiB、README20KB、脚本90KB；不支持ZIP或动态Node代码。
2. 审阅元数据、完整执行内容、风险和Schema，点击安装。安装使用预览时已缓存的内容，10分钟失效，不会在确认后读取被替换的脚本。
3. 安装后默认禁用。启用后新建AI会话，模型可以调用此工具；已开始会话固定工具版本目录，不会自动增加后安装的能力。
4. 导入工具统一视作潜在变更，基础风险至少60；只读/建议模式拒绝，自主/确认模式均需要逐次审批，风险81以上拒绝。不信任包自报readonly。运行时固定目标、参数和版本，等待审批时升级/禁用会阻止执行。
5. 工具经过现有TaskManager提交到SSH服务器systemd，沿用超时、日志脱敏、持久退出码、恢复规则；不会在Windows主进程加载脚本。结果记录版本、时间、目标和Task ID。
6. 卸载仅移除注册，不删除历史或远端文件。v1重复ID拒绝；需要更换版本时明确卸载后重新导入，旧会话不会使用新版本继续。未来升级交互不改变这一固定版本约束。

## manifest字段

参考examples/tool-packages/uptime与http-health。id必须为custom.开头，版本为x.y.z；source由系统指定。type为remote-script或http，target固定ssh，verification必须false（第三方不能自封独立验收工具）。

Remote Script以script字段指定包内相对普通文件；拒绝路径穿越、符号链接、超限和已知凭据。输入以JSON存入SRE_TOOL_INPUT环境变量；脚本必须将它作为数据解析，不得eval。stdout必须是单个符合outputSchema的JSON；非零退出、无效JSON、Schema不匹配都记录失败，变更可能已发生，不盲目重试。

HTTP以url声明固定HTTP回环地址，执行GET，不允许重定向、外部目的地或包内认证。参数编码为query，复杂值使用JSON字符串。请求由选定SSH主机发出，工作目录仍是任务目录；目录不存在时先建立或选择现存目录。响应也必须是JSON。

Schema子集：type(object/array/string/number/integer/boolean/null)、description、properties、required、additionalProperties=false、items、标量enum、min/maxLength、minimum/maximum、min/maxItems；最多8层、每个对象50字段。禁止$ref、远程Schema、任意正则和未知关键字。输入顶层必须object；输出可使用任意支持类型。内置工具继续采用原Zod契约，界面JSON Schema仅作展示。

基础风险只是MODULE1的导入下限保护，不是完整风险评分引擎；完整Risk Policy在MODULE5实现。任意脚本仍拥有SSH账号实际权限，工作目录不是命令沙箱。

## 历史兼容

SQLite只增加集合名，不删除/重写原记录。旧会话缺少toolPins时仅允许既有内置工具，读取历史不会要求导入工具存在；新会话保存版本摘要。新禁用状态立即影响未来调用，不改变已保存证据和已执行副作用。
