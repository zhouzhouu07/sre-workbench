# Web健康观测

从当前SSH服务器检查指定回环端口，输出healthy/status/detail。异常是可供Condition判断的数据，不代表工具执行失败。参数只接受整数端口，不支持用户指定URL、认证或脚本。

安装后默认禁用，仍按第三方工具要求逐次审批。此工具不是独立验收工具，最终成功必须再使用内置verify_service。Workflow Condition可引用 `outputs.health.data.healthy`。
