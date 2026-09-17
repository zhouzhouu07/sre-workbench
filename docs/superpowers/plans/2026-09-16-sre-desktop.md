# SRE Desktop Implementation Plan

Goal: implement the user-approved Windows SRE workbench in this directory.
Architecture: Electron isolated renderer, typed IPC, SSH/SFTP main-process services, SQLite and encrypted credentials, persistent remote jobs.
Spec: approved plan in the conversation, mirrored by the requirements below.

## Global constraints

- Chinese Windows desktop for 1–20 hosts. Ubuntu 22.04/24.04 and Debian 12 x86_64.
- All remote mutations require an explicit UI action; AI scripts require exact-content preview token.
- No secrets in renderer responses, task logs or AI context. No automatic destructive data removal.
- SSH fingerprint TOFU, changed key rejected. Same-host jobs serialized; max three overall.
- Remote systemd jobs survive disconnects. Unknown jobs must be reconciled, never automatically retried.

## Task 1: transport, persistence, jobs

- [ ] Write failing tests for approval binding, shell quoting, redaction, scheduler and persistence.
- [ ] Implement src/main/core with Store, SSH manager, task manager, Backend.handle(method,params).
- [ ] Verify tests; review boundary validation, SSH authentication, sudo, SFTP and cancellation.

## Task 2: renderer and desktop packaging

- [ ] Write Electron UI navigation and host-validation acceptance tests.
- [ ] Implement Chinese pages, host forms, terminal, SFTP, tasks, deployment and monitoring editors, AI scripts and settings.
- [ ] Wire Electron isolated IPC, build with Vite/esbuild, package Windows NSIS and portable Git.
- [ ] Run typecheck, production build and Playwright desktop tests.

## Task 3: deployment, monitoring and AI

- [ ] Write failing generator and API tests covering shell/YAML input, deployment health failure and AI malformed responses.
- [ ] Implement deployment templates, local/Git transfer, version rollback, Caddy and monitor configuration/installation.
- [ ] Implement AI providers and HTTP Agent protocol, preview and confirmation.
- [ ] Verify tests and write example projects plus documentation.

## Task 4: integration and release

- [ ] Review whole project for security and missing end-to-end paths; fix concrete findings.
- [ ] Verify typecheck, unit tests, desktop tests, packaged app launch and NSIS creation.
- [ ] Record unexecuted real-host acceptance honestly; deliver artifact paths.
