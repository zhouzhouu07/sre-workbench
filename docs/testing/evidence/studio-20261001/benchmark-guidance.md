# SRE Agent Benchmark

实验 e4249fb3-11d8-4933-a6ed-31e9600dc043，模型 deepseek-flash (anthropic)。

A：通用Agent，无Skill；B：SRE Skill + Plan；C：Agent Builder + Workflow + Risk + Verify。三组保留相同平台安全约束。

已评估样本是成功率分母，setup_failed和待执行样本不计入。null表示未采集。

```json
[
  {
    "mode": "A",
    "total": 4,
    "evaluated": 4,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 2,
    "successRate": 0.5,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 43604,
    "steps": 68,
    "meanAgentSteps": 17,
    "toolCalls": 60,
    "toolFailures": 6,
    "modelCalls": 68,
    "inputTokens": 830185,
    "outputTokens": 15458,
    "totalTokens": 845643,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 5,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  },
  {
    "mode": "B",
    "total": 4,
    "evaluated": 4,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 4,
    "successRate": 1,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 43900.75,
    "steps": 56,
    "meanAgentSteps": 14,
    "toolCalls": 52,
    "toolFailures": 2,
    "modelCalls": 56,
    "inputTokens": 611054,
    "outputTokens": 15382,
    "totalTokens": 626436,
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
    "total": 4,
    "evaluated": 4,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 4,
    "successRate": 1,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 42449.75,
    "steps": 56,
    "meanAgentSteps": 14,
    "toolCalls": 55,
    "toolFailures": 2,
    "modelCalls": 56,
    "inputTokens": 622578,
    "outputTokens": 12919,
    "totalTokens": 635497,
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

- 场景3 A：completed；成功=true；Trace=1bfc59a1-2096-41b7-89ce-15bd8a616404；独立验证=verified: HTTP200 benchmark-ready

- 场景3 B：completed；成功=true；Trace=eab1704a-c50d-45b8-85b6-d67f4ab33deb；独立验证=verified: HTTP200 benchmark-ready

- 场景3 C：completed；成功=true；Trace=b312ac83-b074-4893-af37-ccb5299ae9e4；独立验证=verified: HTTP200 benchmark-ready

- 场景4 A：completed；成功=false；Trace=b1813c0f-bdde-4cff-b518-f25f53322667；独立验证=active
verified: HTTP200 benchmark-ready

- 场景4 B：completed；成功=true；Trace=cfece603-5322-4fa3-9bc4-b5c2a7915f67；独立验证=active
verified: HTTP200 benchmark-ready

- 场景4 C：completed；成功=true；Trace=32784712-6a94-4813-9ca5-a191b17454ed；独立验证=active
verified: HTTP200 benchmark-ready

- 场景7 A：completed；成功=false；Trace=d5a64eb7-b166-40fd-a939-f55c7dd63b79；独立验证=active
verified: HTTP200 benchmark-ready

- 场景7 B：completed；成功=true；Trace=4214c4cb-f6c8-4eb9-bec4-c9cb41d6bd40；独立验证=active
verified: HTTP200 benchmark-ready

- 场景7 C：completed；成功=true；Trace=74612281-0588-41ab-a2b1-7fe7e5c46f9d；独立验证=active
verified: HTTP200 benchmark-ready

- 场景12 A：completed；成功=true；Trace=66a9aa7a-c9df-4ddc-bb89-548355155f45；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"c9826a78-d331-4a89-8dad-f7d5d08fc0f4","status":"failed","exitCode":15}]
- 场景12 B：completed；成功=true；Trace=0e5bfa09-cbfa-49ad-ac5a-e2425b1cdd90；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"1197e1da-b8c7-4db9-bc97-30e06218d8e1","status":"failed","exitCode":15}]
- 场景12 C：completed；成功=true；Trace=296a0d62-4a39-47bc-b3e9-41f71e037db6；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"5b58915f-679d-40f5-8a06-989ccd11b520","status":"failed","exitCode":15}]

完整事件和原始验证证据请同时导出JSON。
