# 外部 Agent 接口 v1

在设置中选择「外部 HTTP Agent」，填写完整 HTTPS URL 和可选 Bearer Token。本机 localhost / 127.0.0.1 可使用 HTTP。

请求为 POST application/json：

```json
{
  "protocolVersion": "1",
  "requestId": "uuid",
  "instruction": "分析这段日志",
  "context": "用户预览并确认的脱敏文本"
}
```

成功返回 HTTP 200：

```json
{
  "summary": "中文分析结果",
  "scripts": [
    {
      "name": "只读巡检",
      "body": "#!/bin/bash\nuptime\ndf -h\n",
      "description": "读取系统负载和磁盘容量，不修改系统",
      "sudo": false
    }
  ]
}
```

`summary` 必须非空；`scripts` 可省略或为空数组，最多十个。脚本正文上限 100,000 字符；HTTP 返回整体上限 1 MiB。非 JSON 或格式不符的返回不会创建任务。模型接口同样要求返回此 JSON，软件会通过系统提示告知模型。

工作台只把用户选择的上下文发给 Agent，不提供 SSH 连接或凭据。Agent 返回的脚本可编辑和保存，执行前还需单独选择主机并确认。请求可取消，超时默认 120 秒，网络错误不会自动重试。示例服务见 examples/agent/server.mjs。

兼容模型接口参考：[OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)。
