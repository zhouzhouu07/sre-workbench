# SRE Agent Benchmark

实验 03b10f3f-9690-4692-9638-247262db6f25，模型 deepseek-flash (anthropic)。

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
    "recoverySuccessRate": null,
    "meanCompletionMs": 45761,
    "steps": 14,
    "meanAgentSteps": 14,
    "toolCalls": 13,
    "toolFailures": 0,
    "modelCalls": 14,
    "inputTokens": 109140,
    "outputTokens": 4510,
    "totalTokens": 113650,
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
    "recoverySuccessRate": null,
    "meanCompletionMs": 82153,
    "steps": 31,
    "meanAgentSteps": 31,
    "toolCalls": 28,
    "toolFailures": 1,
    "modelCalls": 31,
    "inputTokens": 332357,
    "outputTokens": 8955,
    "totalTokens": 341312,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 2,
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
    "recoverySuccessRate": null,
    "meanCompletionMs": 58015,
    "steps": 20,
    "meanAgentSteps": 20,
    "toolCalls": 19,
    "toolFailures": 0,
    "modelCalls": 20,
    "inputTokens": 181775,
    "outputTokens": 6416,
    "totalTokens": 188191,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 1,
    "verificationFailures": 0,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  }
]
```

- 场景1 A：completed；成功=true；Trace=e7349729-61be-4daf-8fd7-016ae9f0285f；独立验证=active
verified: HTTP200 benchmark-ready

- 场景1 B：completed；成功=true；Trace=bdffbf98-c89a-45f6-a9ed-46ce49a51279；独立验证=active
verified: HTTP200 benchmark-ready

- 场景1 C：completed；成功=true；Trace=a98ce8a2-7d5e-44cf-9ef4-7d20c16f9040；独立验证=active
verified: HTTP200 benchmark-ready


完整事件和原始验证证据请同时导出JSON。
