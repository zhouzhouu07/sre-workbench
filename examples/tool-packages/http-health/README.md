# HTTP工具示例

只从选定SSH主机请求127.0.0.1:18091/health，期望返回{"status":"ready"}或{"status":"failed"}。本示例不创建服务，也不假定该端口已存在服务。

通过现有持久Task执行固定curl GET，禁止重定向、外部主机和包内凭据；输入参数按查询参数编码。响应必须是符合outputSchema的JSON，HTTP成功不等于业务ready。自定义工具不能取代内置后置验收。
