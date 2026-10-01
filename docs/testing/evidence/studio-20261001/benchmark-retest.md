# SRE Agent Benchmark

实验 fc18c453-26c1-43f5-b3bc-4f6105ab226c，模型 deepseek-flash (anthropic)。

A：通用Agent，无Skill；B：SRE Skill + Plan；C：Agent Builder + Workflow + Risk + Verify。三组保留相同平台安全约束。

已评估样本是成功率分母，setup_failed和待执行样本不计入。null表示未采集。

```json
[
  {
    "mode": "A",
    "total": 5,
    "evaluated": 5,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 4,
    "successRate": 0.8,
    "recoverySuccessRate": null,
    "meanCompletionMs": 55933.6,
    "steps": 104,
    "meanAgentSteps": 20.8,
    "toolCalls": 95,
    "toolFailures": 8,
    "modelCalls": 104,
    "inputTokens": 949219,
    "outputTokens": 29848,
    "totalTokens": 979067,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 7,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  },
  {
    "mode": "B",
    "total": 5,
    "evaluated": 5,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 2,
    "successRate": 0.4,
    "recoverySuccessRate": null,
    "meanCompletionMs": 54387.8,
    "steps": 98,
    "meanAgentSteps": 19.6,
    "toolCalls": 85,
    "toolFailures": 3,
    "modelCalls": 99,
    "inputTokens": 897088,
    "outputTokens": 34737,
    "totalTokens": 931825,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 3,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  },
  {
    "mode": "C",
    "total": 5,
    "evaluated": 5,
    "setupFailures": 0,
    "environmentBlocks": 0,
    "successes": 4,
    "successRate": 0.8,
    "recoverySuccessRate": null,
    "meanCompletionMs": 50256,
    "steps": 93,
    "meanAgentSteps": 18.6,
    "toolCalls": 86,
    "toolFailures": 2,
    "modelCalls": 93,
    "inputTokens": 924302,
    "outputTokens": 26928,
    "totalTokens": 951230,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 2,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  }
]
```

- 场景1 A：completed；成功=true；Trace=48fc5a3f-f3c5-4d65-9a35-3c973fd6558f；独立验证=active
verified: HTTP200 benchmark-ready

- 场景1 B：completed；成功=true；Trace=25b47771-1413-47ea-a515-125cfe9c8cf1；独立验证=active
verified: HTTP200 benchmark-ready

- 场景1 C：completed；成功=true；Trace=8503d888-59f2-4eb0-a036-fec56d10a0ed；独立验证=active
verified: HTTP200 benchmark-ready

- 场景2 A：completed；成功=true；Trace=407caccb-f53c-4173-8657-c9ba01578dd3；独立验证=active
verified: HTTP200 benchmark-ready

- 场景2 B：completed；成功=true；Trace=4629483d-a0f9-4db3-bdfd-6d7defb02a53；独立验证=active
verified: HTTP200 benchmark-ready

- 场景2 C：completed；成功=false；Trace=bc332741-5ab6-4d08-b59c-168b893dfdc9；独立验证=active
verified: HTTP200 benchmark-ready

- 场景3 A：completed；成功=true；Trace=d4de1397-f37e-409a-916d-f3e6e983d275；独立验证=verified: HTTP200 benchmark-ready

- 场景3 B：completed；成功=false；Trace=11567478-214e-476e-b7f9-1a4ce6e95dc7；独立验证=verified: HTTP200 benchmark-ready

- 场景3 C：completed；成功=true；Trace=fee9f563-d6d6-4094-b75a-05261474fe5a；独立验证=verified: HTTP200 benchmark-ready

- 场景4 A：completed；成功=false；Trace=efe79501-a828-495a-a481-c0f0e90807a1；独立验证=active
verified: HTTP200 benchmark-ready

- 场景4 B：completed；成功=false；Trace=a7956234-1295-4669-b36e-e56400e6ab44；独立验证=active
verified: HTTP200 benchmark-ready

- 场景4 C：completed；成功=true；Trace=0df74218-1c5b-4849-abd2-361a11159940；独立验证=active
verified: HTTP200 benchmark-ready

- 场景5 A：completed；成功=true；Trace=619423ca-cc54-4e47-bad1-106beadec73b；独立验证=active
verified: HTTP200 benchmark-ready

- 场景5 B：completed；成功=false；Trace=d440b40b-0e60-4b39-a957-e93a36cec2b7；独立验证=inactive

- 场景5 C：completed；成功=true；Trace=35188e35-f2bd-4b62-aa43-57e15d72bafe；独立验证=active
verified: HTTP200 benchmark-ready


完整事件和原始验证证据请同时导出JSON。
