# Core API

`Backend(options)` exposes `store`, `ssh`, `tasks`. Call `await init()` before use, `await close()` at exit. Options: dataDir, encrypt/decrypt string codecs, emit(AppEvent), chooseFile(mode).

Store: `list<T>(collection): T[]`, `get<T>(collection,id): T|undefined`, `put(collection,{id,...}): void`, `remove(collection,id): void`, `setSecret(value,id?): string`, `getSecret(id): string|undefined`, `deleteSecret(id)`, `redact(text): string`, `snapshot(): Snapshot`. Collections: hosts/tasks/scripts/deployments/releases/monitoring/providers. Secret values are encrypted before SQLite persistence. All writes persist synchronously and atomically.

SSH: `exec(hostId,command,{sudo?,timeout?,input?}?) => Promise<{stdout,stderr,code}>`; `upload(hostId,localPath,remotePath)`, `download(hostId,remotePath,localPath)`, `write(hostId,path,content)`, `read(hostId,path)`, `mkdir(hostId,path)`, `list(hostId,path)`. Paths must be absolute. Host verification always enforced for authenticated operations.

Tasks: `preview(spec): ExecutionPreview`, `run(token,spec): Task` (single-use, 10-minute approval bound to canonical exact specification plus host identity), `cancel(id): Promise<Task>`, `reconcile(id): Promise<Task>`. Persistent remote systemd services, three globally, one per host. Unknown tasks block their host until reconciled.

RPC shapes (`params` is an object; unsupported methods/fields rejected):

- snapshot {}
- host.save HostInput; host.delete {id}; host.probe {id} => {fingerprint}; host.trust {id,fingerprint}; host.check {id}
- inspect {hostId,kind:overview|processes|services|journal|containers,unit?} => {stdout,stderr,code}
- service.action {hostId,unit,action:start|stop|restart|enable|disable} => ExecutionPreview
- container.action {hostId,id,action:start|stop|restart} => ExecutionPreview
- execution.preview ExecutionSpec; execution.run {token,spec:ExecutionSpec} => Task
- terminal.open {hostId,cols?,rows?} => {id}; terminal.write {id,data}; terminal.resize {id,cols,rows}; terminal.close {id}; events {type:'terminal',id,data}
- file.list/read {hostId,path}; file.write {hostId,path,content}; file.mkdir/remove {hostId,path}; file.rename {hostId,path,destination}; file.upload {hostId,path,localPath}; file.download {hostId,path,localPath}. remove deletes only a file or empty directory, never recursively.
- dialog.open {mode:file|directory|save} => string|null
- script.save {name,body} => ScriptVersion; script.delete {id} => true (one saved version)
- task.cancel/reconcile {id}; task.delete {id} => true (terminal local record only; rejects pending cleanup and dependent tasks)

Host editing may omit password/privateKey to preserve existing credentials; changing auth type requires a new credential. Changing connection identity clears trusted fingerprint. host.probe does not authenticate; trust is separate, accepts only the most recently probed fingerprint and refuses replacing existing keys. To adopt a changed host key, delete and recreate the host after independent verification.

Renderer must explicitly confirm destructive mutations and file overwrite. service/container actions only prepare a preview; execution.run performs the approved operation. Secrets never appear in snapshots. Scripts may intentionally output secrets unknown to the application; arbitrary script stdout cannot be completely sanitized.

## Persistence and job execution details

- SQLite is exported to a flushed temporary file and atomically renamed after every mutation. App should obtain Electron single-instance lock before opening Store. Credentials use the injected Electron safeStorage codec; deployment/monitoring feature services must put secrets in `setSecret` and persist references, never raw secret fields.
- `snapshot()` removes internal task spec/directory/submission metadata. Task log retention is capped at 1MB, SSH command output at 2MB, editor content at 1MB. Unknown secrets printed by arbitrary user scripts cannot be reliably recognized; stored credential values and authorization headers are redacted.
- Root jobs run as system services; non-root sudo jobs run through configured sudo password or passwordless sudo. Login password is not implicitly reused as the sudo password. Root does not require a sudo binary.
- Non-root non-sudo jobs require a working systemd user manager and `loginctl enable-linger USER`. The precheck fails before submission if persistence cannot be guaranteed. Administrators can enable lingering or select sudo at preview.
- Each task uses `$HOME/.local/share/sre-workbench/jobs/UUID`, script and bounded output log, persistent exit marker and a named transient systemd service with RuntimeMaxSec. Services survive SSH disconnect; a machine reboot can leave a task unknown if no exit marker exists. No automatic retry or job-file cleanup occurs.
- Running/queued jobs become unknown after application restart. Unknown jobs reserve concurrency slots and block their host until manual reconciliation. Prepared-but-never-submitted jobs reconcile as cancelled. Missing systemd units without a persistent result stay unknown and require manual host inspection.
- File upload/download RPCs accept only a local path previously returned by `dialog.open` in this process. Feature services may call the SSH transfer methods directly for trusted temporary artifacts. Deletion only unlinks a file or removes an empty directory.
- `TaskManager.close()` is asynchronous; Backend.close waits for local monitors/SSH shutdown before closing SQLite.

## Verification limits

Automated tests include a real local ssh2 server for TOFU/password verification and changed-key rejection; unit tests cover persistence, redaction, approval binding, scheduler, schema validation, restart and remote-result reconciliation. Ubuntu/Debian real-host systemd, SFTP, sudo, interactive terminal, disconnect/reconnect and cancellation acceptance still requires actual SSH target machines.
