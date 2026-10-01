# SRE Agent Benchmark

实验 70720587-97fa-49cc-8d73-fac1fb382071，模型 deepseek-flash (anthropic)。

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
    "meanCompletionMs": 29502,
    "steps": 10,
    "meanAgentSteps": 10,
    "toolCalls": 9,
    "toolFailures": 1,
    "modelCalls": 10,
    "inputTokens": 67551,
    "outputTokens": 3197,
    "totalTokens": 70748,
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
    "successes": 1,
    "successRate": 1,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 36599,
    "steps": 11,
    "meanAgentSteps": 11,
    "toolCalls": 10,
    "toolFailures": 1,
    "modelCalls": 11,
    "inputTokens": 79095,
    "outputTokens": 4095,
    "totalTokens": 83190,
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
    "mode": "C",
    "total": 1,
    "evaluated": 1,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 1,
    "successRate": 1,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 24496,
    "steps": 8,
    "meanAgentSteps": 8,
    "toolCalls": 8,
    "toolFailures": 1,
    "modelCalls": 8,
    "inputTokens": 41693,
    "outputTokens": 2197,
    "totalTokens": 43890,
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

- 场景12 A：completed；成功=true；Trace=d98ed285-518e-4f85-93a4-8f482d26f278；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"38bcf611-06cd-4a35-bee3-7b7af6f41748","status":"failed","exitCode":15}]
- 场景12 B：completed；成功=true；Trace=650bf2d1-d8a5-4f53-a63e-5426fc296288；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"92632ee5-287c-4952-b52a-7909bf8eaf93","status":"failed","exitCode":15}]
- 场景12 C：completed；成功=true；Trace=3e75534e-4c3b-4836-8a2c-30fc642a4a3b；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"7547a140-4a10-4433-ac15-78c40fe217cc","status":"failed","exitCode":15}]

完整事件和原始验证证据请同时导出JSON。
