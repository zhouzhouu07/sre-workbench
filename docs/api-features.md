# Feature RPC contract

FeatureService(core, {gitPath:string,tempDir:string,openExternal:(url:string)=>Promise<void>}) owns deployment and monitoring. Export from src/main/features/operations.ts. handle(method,params), close(). Core API in api-core.md.

- deployment.save { ...DeploymentSpec, id?:string, gitToken?:string } => DeploymentSpec. env secrets encrypted at rest, returned env values redacted; editing preserves redacted values. Use a separate secret reference per deployment; no plaintext secret values in snapshot.
- deployment.detect {path:string,template} => inferred fields for wizard. Read local package.json/requirements.txt/Dockerfile; never execute local project scripts.
- deployment.preview {id} => {token,summary,script}; read-only preflight allowed. No writes/clone/upload until confirm.
- deployment.run {id,token} => Task; approval bound saved spec plus target identity. Preparation integrated in same-host scheduling or safely bound isolated staging. Remote job healthchecks and switches Caddy only on success, retains prior version; releases reconciled from remote success marker.
- deployment.rollback.preview {id,releaseId} => same preview
- deployment.rollback.run {id,releaseId,token} => Task
- monitoring.save {...MonitoringStack,id?:string,smtpPassword?:string,grafanaPassword?:string} => MonitoringStack
- monitoring.preview {id} => {token,summary,script}; run {id,token} => Task[] (exporters and stack installation with per-host serialization/dependencies). Monitoring credentials never included in returned previews or logs; clearly describe secret file writes in summary.
- monitoring.open {id,service:'grafana'|'prometheus'|'alertmanager'} => URL; create SSH tunnel bound 127.0.0.1, open default browser. Persist no local port.
- monitoring.test {id} => sends synthetic test alert to Alertmanager through SSH; user clicked explicit send-test button.
- monitoring.silence {id,alertname,minutes,comment} => creates silence. Validate minutes and nonempty reason.
- monitoring.status {id} => {targets:unknown,alerts:unknown,silences:unknown} via remote loopback API.

AIService implements provider.save/delete and ai.preview/request/cancel separately (root-owned).
All parameters validated before execution. No fabricated success; remote exit codes and API errors must propagate. UI uses rejected promise errors verbatim as notification.
