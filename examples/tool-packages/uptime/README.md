# 运行时间工具示例

在Agent Studio的Tool Center选择此目录导入，审阅脚本后安装，再显式启用。

脚本在已授权SSH服务器运行，依赖Linux /proc/uptime和cut。输入为{}，输出单个JSON对象。虽然manifest声明readonly，系统仍将第三方脚本视为潜在变更，基础风险至少60，每次需要审批；不会在只读会话执行。参数通过SRE_TOOL_INPUT环境变量的JSON传入，不能将其eval为shell。

安装或卸载不会运行脚本；不能把脚本自报成功作为业务独立验收。
