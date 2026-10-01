# SRE Agent Benchmark

实验 837b5877-dd94-445b-93dd-69cc5e0bff4b，模型 deepseek-flash (anthropic)。

A：通用Agent，无Skill；B：SRE Skill + Plan；C：Agent Builder + Workflow + Risk + Verify。三组保留相同平台安全约束。

已评估样本是成功率分母，setup_failed和待执行样本不计入。null表示未采集。

```json
[
  {
    "mode": "A",
    "total": 12,
    "evaluated": 1,
    "setupFailures": 0,
    "environmentBlocks": 4,
    "successes": 0,
    "successRate": 0,
    "recoverySuccessRate": null,
    "meanCompletionMs": 74081,
    "steps": 28,
    "meanAgentSteps": 28,
    "toolCalls": 27,
    "toolFailures": 2,
    "modelCalls": 28,
    "inputTokens": 251456,
    "outputTokens": 12810,
    "totalTokens": 264266,
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
    "total": 12,
    "evaluated": 1,
    "setupFailures": 0,
    "environmentBlocks": 4,
    "successes": 1,
    "successRate": 1,
    "recoverySuccessRate": null,
    "meanCompletionMs": 46887,
    "steps": 14,
    "meanAgentSteps": 14,
    "toolCalls": 13,
    "toolFailures": 0,
    "modelCalls": 14,
    "inputTokens": 132413,
    "outputTokens": 5345,
    "totalTokens": 137758,
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
    "total": 12,
    "evaluated": 0,
    "setupFailures": 0,
    "environmentBlocks": 5,
    "successes": 0,
    "successRate": null,
    "recoverySuccessRate": null,
    "meanCompletionMs": null,
    "steps": 0,
    "meanAgentSteps": null,
    "toolCalls": 0,
    "toolFailures": 0,
    "modelCalls": null,
    "inputTokens": null,
    "outputTokens": null,
    "totalTokens": null,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": null,
    "riskBlocks": 0,
    "verificationFailures": 0,
    "resumeSuccesses": 0,
    "resumeSuccessRate": null,
    "incorrectSuccessClaims": 0
  }
]
```

- 场景1 A：completed；成功=false；Trace=e9f22c04-c324-4a1f-96b2-fadf614b5f8a；独立验证=active
verified: HTTP200 benchmark-ready

- 场景1 B：completed；成功=true；Trace=a440b399-ac6f-47ed-8716-af1f00a67780；独立验证=active
verified: HTTP200 benchmark-ready

- 场景1 C：environment_blocked；成功=未评估；Trace=9d189ae8-f7fb-4341-8504-24439b1f8d64；独立验证=inactive

- 场景2 A：environment_blocked；成功=未评估；Trace=6a4c15f2-28d2-4298-b891-8483ec7898b8；独立验证=inactive

- 场景2 B：environment_blocked；成功=未评估；Trace=fb8e49cf-302b-4b81-9852-b461d7b631be；独立验证=inactive

- 场景2 C：environment_blocked；成功=未评估；Trace=b353af70-35d4-4d74-b7c2-097ecd5c2313；独立验证=inactive

- 场景3 A：environment_blocked；成功=未评估；Trace=0319d603-ff23-41f8-9dba-66e49e67fcb5；独立验证=
- 场景3 B：environment_blocked；成功=未评估；Trace=7cf761ac-9a2a-4749-8fb2-f2617a67d8f5；独立验证=
- 场景3 C：environment_blocked；成功=未评估；Trace=3fc22dd6-4542-4205-94c3-37b67ba9c16d；独立验证=
- 场景4 A：environment_blocked；成功=未评估；Trace=d82879e4-e60b-46c1-81a9-dd16e7cfdb58；独立验证=failed

- 场景4 B：environment_blocked；成功=未评估；Trace=ff5eb325-befd-413c-8d18-5437a4ca3f40；独立验证=failed

- 场景4 C：environment_blocked；成功=未评估；Trace=1d56e06e-1b67-4216-a3a9-0959f1a06036；独立验证=failed

- 场景5 A：environment_blocked；成功=未评估；Trace=367787c7-ef4e-4661-a8b8-cf75d39d5705；独立验证=inactive

- 场景5 B：environment_blocked；成功=未评估；Trace=7c28ca70-e83f-4a67-aad9-cb2d48d3308b；独立验证=inactive

- 场景5 C：environment_blocked；成功=未评估；Trace=b7bdce85-fd22-4563-a9e2-c123d01c48bc；独立验证=inactive

- 场景6 A：preparing；成功=未评估；Trace=无；独立验证=未执行
- 场景6 B：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景6 C：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景7 A：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景7 B：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景7 C：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景8 A：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景8 B：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景8 C：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景9 A：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景9 B：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景9 C：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景10 A：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景10 B：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景10 C：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景11 A：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景11 B：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景11 C：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景12 A：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景12 B：pending；成功=未评估；Trace=无；独立验证=未执行
- 场景12 C：pending；成功=未评估；Trace=无；独立验证=未执行

完整事件和原始验证证据请同时导出JSON。
