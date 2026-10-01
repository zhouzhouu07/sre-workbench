# SRE Agent Benchmark

实验 837b5877-dd94-445b-93dd-69cc5e0bff4b，模型 deepseek-flash (anthropic)。

A：通用Agent，无Skill；B：SRE Skill + Plan；C：Agent Builder + Workflow + Risk + Verify。三组保留相同平台安全约束。

已评估样本是成功率分母，setup_failed和待执行样本不计入。null表示未采集。

```json
[
  {
    "mode": "A",
    "total": 12,
    "evaluated": 8,
    "setupFailures": 0,
    "environmentBlocks": 4,
    "successes": 6,
    "successRate": 0.75,
    "recoverySuccessRate": 0.75,
    "meanCompletionMs": 246755,
    "steps": 150,
    "meanAgentSteps": 18.75,
    "toolCalls": 138,
    "toolFailures": 7,
    "modelCalls": 150,
    "inputTokens": 1207758,
    "outputTokens": 48199,
    "totalTokens": 1255957,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 4,
    "resumeSuccesses": 2,
    "resumeSuccessRate": 1,
    "incorrectSuccessClaims": 0
  },
  {
    "mode": "B",
    "total": 12,
    "evaluated": 8,
    "setupFailures": 0,
    "environmentBlocks": 4,
    "successes": 7,
    "successRate": 0.875,
    "recoverySuccessRate": 0.75,
    "meanCompletionMs": 57139.25,
    "steps": 134,
    "meanAgentSteps": 16.75,
    "toolCalls": 127,
    "toolFailures": 2,
    "modelCalls": 134,
    "inputTokens": 992880,
    "outputTokens": 40724,
    "totalTokens": 1033604,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 0,
    "resumeSuccesses": 2,
    "resumeSuccessRate": 1,
    "incorrectSuccessClaims": 0
  },
  {
    "mode": "C",
    "total": 12,
    "evaluated": 7,
    "setupFailures": 0,
    "environmentBlocks": 5,
    "successes": 6,
    "successRate": 0.8571428571428571,
    "recoverySuccessRate": 1,
    "meanCompletionMs": 61039,
    "steps": 126,
    "meanAgentSteps": 18,
    "toolCalls": 119,
    "toolFailures": 6,
    "modelCalls": 126,
    "inputTokens": 893377,
    "outputTokens": 36506,
    "totalTokens": 929883,
    "approvalRequests": 0,
    "humanApprovals": 0,
    "humanInterventionRate": 0,
    "riskBlocks": 0,
    "verificationFailures": 3,
    "resumeSuccesses": 40,
    "resumeSuccessRate": 1,
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

- 场景6 A：completed；成功=true；Trace=bd5755d4-b90d-44a2-a35f-013f65f68701；独立验证=active
active
verified: HTTP200 benchmark-ready

- 场景6 B：completed；成功=true；Trace=b2ff5349-83fe-4e82-b512-8098cb4f2c9e；独立验证=active
active
verified: HTTP200 benchmark-ready

- 场景6 C：completed；成功=true；Trace=55064c55-e9f0-4eb0-a935-813cdce5af75；独立验证=active
active
verified: HTTP200 benchmark-ready

- 场景7 A：completed；成功=true；Trace=26e26e7e-d41d-475f-a399-37d94bae309d；独立验证=active
verified: HTTP200 benchmark-ready

- 场景7 B：completed；成功=true；Trace=a2cc9d42-aecf-494c-8ceb-6a777978556f；独立验证=active
verified: HTTP200 benchmark-ready

- 场景7 C：completed；成功=false；Trace=4d12e825-097d-4d2e-a363-d83a191ef95d；独立验证=active
verified: HTTP200 benchmark-ready

- 场景8 A：completed；成功=true；Trace=653e3f53-d641-4eab-b50a-6514f1c90472；独立验证=active
verified: HTTP200 benchmark-ready

- 场景8 B：completed；成功=true；Trace=f9e7ecbd-b736-4008-8879-dc7339da75ba；独立验证=active
verified: HTTP200 benchmark-ready

- 场景8 C：completed；成功=true；Trace=e5e4c1f0-5a89-418f-ad76-ee0e0765b2fd；独立验证=active
verified: HTTP200 benchmark-ready

- 场景9 A：completed；成功=true；Trace=c0f836bc-4b6a-40b8-b50f-16e122e05e82；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"4b98f7b1-9807-4f41-8557-69802b91aaab","status":"succeeded","exitCode":0}]
- 场景9 B：completed；成功=true；Trace=d0f85657-1a58-4d70-b07f-d8068fed0a69；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"a2b5b47c-e6ef-4860-923d-7dfc9a7b00a3","status":"succeeded","exitCode":0}]
- 场景9 C：completed；成功=true；Trace=b392ce8d-c6c6-4fba-ba3b-1680568d48ab；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"399a8340-208b-428c-aac8-593d1b9e6b7d","status":"succeeded","exitCode":0}]
- 场景10 A：completed；成功=true；Trace=d567aebf-133b-4815-bcc5-389b800d8612；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"88e862f5-2574-49a1-97b4-4cbe49936448","status":"succeeded","exitCode":0}]
- 场景10 B：completed；成功=true；Trace=5f0a0e2a-d414-4241-8948-18a64821c03f；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"a0df76fc-5f25-47a9-99e4-a9d1d96c761f","status":"succeeded","exitCode":0}]
- 场景10 C：completed；成功=true；Trace=4c8fe6f6-1368-43ae-9781-c5c17ecfd4a6；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"5a013348-d453-4eae-b882-d625fd9273a7","status":"succeeded","exitCode":0}]
- 场景11 A：completed；成功=true；Trace=b1e0fc45-1a09-488e-8009-716b7e75ecfd；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"7237c1e7-02a9-4d0f-b676-9525c0e97d60","status":"succeeded","exitCode":0}]
- 场景11 B：completed；成功=true；Trace=ac7440cd-5927-45d7-a1b2-cf2a604c6dc4；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"f159e9ce-ed94-4ad5-8818-1f7d7b16dbc6","status":"succeeded","exitCode":0}]
- 场景11 C：completed；成功=true；Trace=49d0f6fd-4c80-40e2-8054-c68b64777fdd；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"5a945530-9a9e-4bbc-8cfb-a0f441084a5a","status":"succeeded","exitCode":0}]
- 场景12 A：completed；成功=false；Trace=7023c5ce-6611-4dcb-a24b-677e653fcc13；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"c98a067d-e917-4e23-b9fb-baea95b03dd3","status":"failed","exitCode":15}]
- 场景12 B：completed；成功=false；Trace=8435d2c3-a650-42ec-9ae0-c8230c7c83e1；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"5d9e84c4-f242-4b50-9138-d40916721603","status":"failed","exitCode":15}]
- 场景12 C：completed；成功=true；Trace=d58a1c79-bf6e-4130-8cf1-4bc5b7eb0d30；独立验证=verified: single invocation

Persistent Task evidence: [{"id":"1752fcb7-6b08-402d-a818-6c956173460d","status":"failed","exitCode":15}]

完整事件和原始验证证据请同时导出JSON。
