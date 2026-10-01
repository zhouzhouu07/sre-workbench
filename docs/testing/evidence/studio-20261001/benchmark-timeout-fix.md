# SRE Agent Benchmark

实验 8581a94b-fb94-452e-a20c-262e6a9dc16c，模型 deepseek-flash (anthropic)。

A：通用Agent，无Skill；B：SRE Skill + Plan；C：Agent Builder + Workflow + Risk + Verify。三组保留相同平台安全约束。

已评估样本是成功率分母，setup_failed和待执行样本不计入。null表示未采集。

```json
[
  {
    "mode": "A",
    "total": 1,
    "evaluated": 1,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 1,
    "successRate": 1,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 35501,
    "steps": 14,
    "meanAgentSteps": 14,
    "toolCalls": 12,
    "toolFailures": 1,
    "modelCalls": 14,
    "inputTokens": 20523,
    "outputTokens": 5465,
    "totalTokens": 25988,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 0,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  },
  {
    "mode": "B",
    "total": 1,
    "evaluated": 1,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 0,
    "successRate": 0,
    "recoverySuccessRate": 0,
    "meanCompletionMs": 48538,
    "steps": 19,
    "meanAgentSteps": 19,
    "toolCalls": 14,
    "toolFailures": 3,
    "modelCalls": 19,
    "inputTokens": 56881,
    "outputTokens": 7139,
    "totalTokens": 64020,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 2,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  },
  {
    "mode": "C",
    "total": 1,
    "evaluated": 1,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 1,
    "successRate": 1,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 29473,
    "steps": 11,
    "meanAgentSteps": 11,
    "toolCalls": 11,
    "toolFailures": 1,
    "modelCalls": 11,
    "inputTokens": 27032,
    "outputTokens": 3300,
    "totalTokens": 30332,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 0,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  }
]
```

- 场景12 A：completed；成功=true；Trace=98ef162c-1003-49eb-bede-b84c9041d338；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"44edecc1-435d-4ca2-8062-3490570cc094","status":"failed","exitCode":15}]
- 场景12 B：completed；成功=false；Trace=cf79b083-28d4-405b-bf7a-e8e406ee25f6；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"fb0d8772-753e-4ece-8083-c907039e0feb","status":"failed","exitCode":15}]
- 场景12 C：completed；成功=true；Trace=8403f6ce-d541-4ff2-9a2f-7d4f4912d3ef；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"abf42b66-98f2-4cc9-926a-44c349996166","status":"failed","exitCode":15}]

完整事件和原始验证证据请同时导出JSON。
