# Feature RPC contract

FeatureService(core, {gitPath:string,tempDir:string,openExternal:(url:string)=>Promise<void>}) owns deployment and monitoring. Export from src/main/features/operations.ts. handle(method,params), close(). Core API in api-core.md.

- deployment.save { ...DeploymentSpec, id?:string, gitToken?:string } => DeploymentSpec. env secrets encrypted at rest, returned env values redacted; editing preserves redacted values. Use a separate secret reference per deployment; no plaintext secret values in snapshot.
- deployment.detect {path:string,template} => inferred fields for wizard. Read local package.json/requirements.txt/Dockerfile; never execute local project scripts.
- deployment.preflight {id,releaseId?} => {deploymentId,hostId,checkedAt,ready,checks:[{id,status:'pass'|'warn'|'fail',detail}]}. Read-only SSH inspection of platform, privilege, systemd/tools, resources, Docker/Compose, runtime conflicts, TCP ports (and UDP 443 for domains), DNS and bind directories; includes SELinux/firewall advisories. Failed checks block the UI. The run preparation repeats the checks before uploading sources, including when callers bypass the UI.
- deployment.preview {id} => {token,summary,script}; read-only preflight allowed. No writes/clone/upload until confirm.
- deployment.run {id,token} => Task; approval bound saved spec plus target identity. Preparation integrated in same-host scheduling or safely bound isolated staging. Remote job healthchecks and switches Caddy only on success, retains prior version; releases reconciled from remote success marker.
- deployment.rollback.preview {id,releaseId} => same preview
- deployment.rollback.run {id,releaseId,token} => Task
- monitoring.save {...MonitoringStack,id?:string,smtpPassword?:string,grafanaPassword?:string} => MonitoringStack
- MonitoringStack accepts grafanaUsername (default admin), grafanaPort (3000), prometheusPort (9090), alertmanagerPort (9093). Ports must be distinct integers 1–65535; existing records retain defaults. Username/password initialize new Grafana data only, never reset existing accounts. Host mappings remain loopback-only. Opening/querying/mutating monitoring validates Compose project, service and loopback port ownership. Saving closes existing tunnels. Run checks port conflicts before creating exporter tasks and again during stack preparation.
- monitoring.preview {id} => {token,summary,script}; run {id,token} => Task[] (exporters and stack installation with per-host serialization/dependencies). Monitoring credentials never included in returned previews or logs; clearly describe secret file writes in summary.
- monitoring.open {id,service:'grafana'|'prometheus'|'alertmanager'} => URL; create SSH tunnel bound 127.0.0.1, open default browser. Persist no local port.
- monitoring.test {id} => sends synthetic test alert to Alertmanager through SSH; user clicked explicit send-test button.
- monitoring.silence {id,alertname,minutes,comment} => creates silence. Validate minutes and nonempty reason.
- monitoring.status {id} => {targets:unknown,alerts:unknown,silences:unknown} via remote loopback API.

deployment.delete / monitoring.delete {id} remove local configurations and associated credentials; deployment deletion also removes local release metadata. No remote uninstall is performed. Related host tasks must be finished, verified and fully cleaned up.

AIService implements provider.save/delete/test and ai.preview/request/cancel. Model providers accept optional protocol: auto|openai|anthropic (existing records default to auto). provider.test {id} sends a fixed short probe and returns {protocol,endpoint,elapsedMs}; no user logs are sent.
All parameters validated before execution. No fabricated success; remote exit codes and API errors propagate. Validation errors are converted into readable field messages before IPC delivery. MonitoringStack.smtpEnabled is optional; old records infer enabled state from smtpHost. Presets fill the login from the sender; custom blank usernames preserve anonymous SMTP behavior.

## AI task sessions (source implementation, acceptance pending)

`AgentService(core, ai, emit)` handles `ai.session.*`. It uses existing model providers through an internal `AIService.agentStep` transport. External HTTP Agent v1 and the old `ai.preview/request` contracts are unchanged. No new third-party runtime dependency is required.

- `ai.session.start {providerId, permission:'advice'|'readonly'|'confirm'|'autonomous', target, instruction, maxSteps?:1..100}` → AgentSession. Default 40 steps; one active AI session globally. `target` is `{kind:'local',root}` or `{kind:'ssh',root,hostId,sudo}`. Local root must already exist; remote root may be created by an approved mutation. Provider must be a model, and remote host fingerprint must already be trusted.
- `ai.session.list {}` → newest-first session summaries with empty steps and stepCount; `ai.session.get {id}` → full public session.
- `ai.session.approve {id,stepId,approved}` → true. Pending step only, ten-minute expiry, no caller-supplied replacement arguments. Provider/host identity must still match.
- `ai.session.reply {id,instruction}` → AgentSession. Continue a completed/failed/cancelled/waiting-for-input session using its immutable target/permission. Unknown sessions cannot resume until explicitly reconciled. Total session record limit: 200.
- `ai.session.stop {id}` → true. Requests cancellation; observe session state for the outcome. Cancels model request, local process tree or associated remote task; no rollback of prior effects.
- `ai.session.resolve {id}` → true. User attests actual state has been inspected. Remote target must have no pending TaskManager work. Marks session cancelled; never replays commands.
- `ai.session.delete {id}` → true. Deletes finished local records only; no generated files or deployed services are removed.

Model reply is one strictly validated JSON tool call, question or finish. Tool registry: list_files/read_file/write_file/make_directory/inspect_system/run_command/http_check. Every execution independently enforces the permission matrix. Read-only mode never admits arbitrary shell commands, regardless of model claims. Model-returned host, sudo, permission and other unexpected tool arguments are rejected. Structured file paths are checked against the root and resolved symlink ancestors; raw terminal commands run with the OS account's authority, **not an OS directory sandbox**. Session host selection does not sandbox a shell's network access.

Tools return observations for subsequent turns. Persistent `aiSessions` records contain sanitized instructions, steps, outputs and remote task references; they are excluded from the general snapshot. Redaction is applied to string fields, not JSON serialization syntax. A call whose displayed arguments require redaction is rejected before execution. Interrupted sessions become unknown on startup; remote writes run through existing persistent TaskManager jobs. Model finish references are accepted only for real successful observation/command steps and are displayed as model-selected evidence, not independent acceptance certification.

Windows local commands use non-interactive Windows PowerShell with hidden windows, timeout and output limits. Remote commands use Bash and the existing SSH/systemd job machinery. HTTP checks are GET requests to HTTP loopback URLs on the chosen target, do not follow redirects and require 2xx. Read-only SSH operations have bounded timeouts; cancelling the session prevents further calls but may wait for a current read to return. `AgentService.close()` is awaited before closing AI transport and backend persistence.

## AI conversations (v0.2.1)

- UI targets trusted SSH hosts only; local execution internals remain for legacy records/tests, with no local target selector.
- ai.session.rename {id,title} changes a title (1–80 characters) without changing task instructions.
- ai.session.pause {id} requests a boundary pause; in-flight work completes, pending approval is invalidated. ai.session.resume {id} continues a paused session with existing observations and unchanged target/provider/permission.
- TaskHooks.source=ai persists provenance; the task center filters these records. Legacy linked tasks are marked on startup. AI steps retain live logs, reconciliation and cancellation controls.
- Anthropic agent requests use a single native submit_step tool input, with thinking disabled and forced tool choice. Multiple calls are rejected; normal runtime argument and permission checks still apply.
