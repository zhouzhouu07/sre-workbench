# SRE Workbench 第一轮清理记录

## 清理前
- 时间：2026-10-03T14:28:20.9673404+08:00
- HEAD：8e5d09139df4efc34f07e3d9542dc8d988c291f1
- 分支：feat/sre-desktop
- 项目逻辑大小：25531119261 字节（23.777708 GiB）
- 普通文件数：66317；重解析链接 1164 个，未跟随。
- D 盘可用空间：18026737664 字节。
- 范围来源：用户本轮明确批准的第一轮清理指令；禁止扩大范围。

### Git 状态摘要
```text
 M README.md
 M docs/codex-next-chat-prompt.md
 M docs/execution-trace.md
 M docs/next-session-handoff.md
 M docs/user-guide.md
 M package.json
 M src/main/features/execution-trace.ts
 M src/main/features/monitoring.ts
 M src/main/features/operations.ts
 M src/main/features/workflow-runtime.ts
 M src/renderer/App.tsx
 M src/renderer/pages/AI.tsx
 M src/renderer/pages/AgentBuilder.tsx
 M src/renderer/pages/AgentStudio.tsx
 M src/renderer/pages/ExecutionRuns.tsx
 M src/renderer/pages/Monitoring.tsx
 M src/renderer/pages/SkillCenter.tsx
 M src/renderer/pages/WorkflowStudio.tsx
 M src/renderer/style.css
 M src/shared/monitoring-form.ts
 M src/shared/trace.ts
 M tests/e2e/agent-builder.spec.ts
 M tests/e2e/execution-trace.spec.ts
 M tests/e2e/skill-center.spec.ts
 M tests/e2e/tool-center.spec.ts
 M tests/execution-trace.test.ts
 M tests/operations.test.ts
 M tests/workflow.test.ts
 M "\351\241\271\347\233\256\350\277\233\347\250\213.md"
?? android-app/
?? docs/next-stage-optimization.md
?? docs/releases/v0.4.1.md
?? docs/software-overview.md
?? docs/testing/2026-10-03-monitoring.md
?? docs/testing/2026-10-03-v0.4.1-package.md
?? docs/testing/evidence/monitoring-20261003/
?? docs/testing/evidence/package-20261003/
?? tests/e2e/monitoring-mail.spec.ts
?? tests/monitoring-health.test.ts
```

### 批准范围及清理前大小
| CLEAN ID | 路径/范围 | 普通文件数 | 逻辑字节 | MiB | 状态 |
|---|---|---:|---:|---:|---|
| CLEAN-001 | android-app/.gradle-user-home/caches | 12488 | 1198373220 | 1142.858 | 待执行 |
| CLEAN-002 | android-app/.gradle-user-home/.tmp | 69 | 28006560 | 26.709 | 待执行 |
| CLEAN-003 | android-app/.gradle | 17 | 4922163 | 4.694 | 待执行 |
| CLEAN-004 | android-app/.android-user/cache | 0 | 0 | 0 | 暂留：adb 占用情况无法确认 |
| CLEAN-005 | node_modules/.vite、.vite-temp | 1 | 1832 | 0.002 | 待执行 |
| CLEAN-006 | 三个 zip.parts 中 211 个逐字节复核一致的 .part | 211 | 1758980393 | 1677.494 | 待执行 |
| CLEAN-007 | app/core/SSH fixture 明确生成型中间文件，保留 XML/HTML/日志/图片/报告/APK | 2485 | 74257123 | 70.817 | 待执行 |
| CLEAN-008 | android-app/.tools/emulator-preview-37.3.2，稳定 37.2.12 保留 | 388 | 1132171850 | 1079.723 | 待执行 |
| CLEAN-009 | 六个已确认完整解压的工具下载 ZIP；稳定工具链保留 | 6 | 2229702466 | 2126.41 | 待执行 |
| CLEAN-010 | 待清理文件/.tools/builder-cache | 378 | 16183252 | 15.434 | 待执行 |
| CLEAN-011 | 待清理文件/.tools/MinGit-2.55.0-64-bit.zip | 1 | 38830800 | 37.032 | 待执行 |
| CLEAN-012 | release/win-unpacked，包内版本已核实 0.4.0 | 539 | 528426319 | 503.947 | 待执行 |
| CLEAN-013-0.3.0 | release 旧 0.3.0 EXE/blockmap；远端摘要上轮已核实 | 2 | 151220127 | 144.215 | 待执行 |
| CLEAN-013-0.2.2 | release 旧 0.2.2 EXE/blockmap；远端摘要上轮已核实 | 2 | 151176660 | 144.173 | 待执行 |
| CLEAN-013-0.2.1 | release 旧 0.2.1 EXE/blockmap；远端摘要上轮已核实 | 2 | 151175259 | 144.172 | 待执行 |
| CLEAN-013-0.2.0 | release 旧 0.2.0 EXE/blockmap；远端摘要上轮已核实 | 2 | 151172987 | 144.17 | 待执行 |
| CLEAN-014-0.1.1 | 待清理文件/release 原 0.1.1 EXE/blockmap；fixes 排除 | 2 | 151134413 | 144.133 | 待执行 |
| CLEAN-014-0.1.0 | 待清理文件/release 原 0.1.0 EXE/blockmap；fixes 排除 | 2 | 151121794 | 144.121 | 待执行 |

CLEAN-004 暂留：发现 adb.exe PID 70124，进程路径及命令行无读取权限，不能确认缓存是否在用；未终止该进程。

### 明确保留范围
Git/源码/测试/配置、原有所有未提交修改、README.md、项目进程.md、docs 及竞赛 Evidence、全部数据库与本机用户 AppData、.tools 原始实验和验证证据、node_modules（仅两个 Vite 缓存例外）、dist、vendor/git、v0.4.1 全目录、v0.4.0 核心发行资产、v0.1.2、v0.1.0 fixes-20260917 全目录、各历史校验清单及 Release Notes。
Android 源码/Gradle/Wrapper/锁文件/脚本、稳定 SDK/JDK/Gradle/emulator、APK outputs、所有报告/XML/HTML/日志/截图、adbkey/adbkey.pub/debug.keystore、.tools/tmp、AVD 均保留。
android-app/.avd 未清理。app/build/snapshot 和 fixture build/install、build/scripts 本轮保守保留。

### 删除条件验证
211 个 .part 本轮重新与完整 ZIP 对应偏移的字节比较，一致；保留三个 parts 目录内 headers/XML/metadata。
六个 ZIP 的每个文件条目逐一核对已解压目标的大小和 SHA256，全部一致；稳定 emulator 37.2.12 保留，preview 37.3.2 已批准移除。
Gradle 脚本定位 .tools/gradle-8.13/bin/gradle.bat；Wrapper JAR 与配置保留。vendor/git 实际可运行：git version 2.55.0.windows.1。
旧免安装 ASAR package.json：0.4.0；v0.4.1 免安装目录排除。历史 Release 依据上一轮已完成的 API size/digest 核验；本轮不操作 GitHub Release。
受保护文件 SHA256 基线数量：3880。数据库/身份文件只核对存在、元数据及摘要，不读取或输出秘密内容。
start-emulator.ps1 的 preview 仅用于 -PrerequisitePreview 且稳定 emulator 缺失时的历史恢复；当前默认稳定路径存在。bootstrap.ps1 下一次执行会重新下载已清除的 ZIP；start-emulator 若未来工具缺失，需先补齐归档。脚本不修改。

## 实际删除
批准项已执行，CLEAN-004 因 adb 占用情况无法确认暂留，详见下表。

清理前补充：暂留 CLEAN-004 实际有 42 个普通文件、3581003 字节；表内删除文件数/字节为 0，表示本轮不删除。
待删除六个历史原包 EXE SHA256 本轮重新核对，与上一轮已确认远端摘要一致的审计值一致。

### 实际删除明细
| CLEAN ID | 路径/范围 | 普通文件数 | 逻辑字节 | MiB | 状态 |
|---|---|---:|---:|---:|---|
| CLEAN-001 | android-app/.gradle-user-home/caches | 12488 | 1198373220 | 1142.858 | 已删除 |
| CLEAN-002 | android-app/.gradle-user-home/.tmp | 69 | 28006560 | 26.709 | 已删除 |
| CLEAN-003 | android-app/.gradle | 17 | 4922163 | 4.694 | 已删除 |
| CLEAN-004 | android-app/.android-user/cache | 0 | 0 | 0 | 暂留：adb 占用情况无法确认 |
| CLEAN-005 | node_modules/.vite、.vite-temp | 1 | 1832 | 0.002 | 已删除 |
| CLEAN-006 | 三个 zip.parts 中 211 个逐字节复核一致的 .part | 211 | 1758980393 | 1677.494 | 已删除 |
| CLEAN-007 | app/core/SSH fixture 明确生成型中间文件，保留 XML/HTML/日志/图片/报告/APK | 2485 | 74257123 | 70.817 | 已删除 |
| CLEAN-008 | android-app/.tools/emulator-preview-37.3.2，稳定 37.2.12 保留 | 388 | 1132171850 | 1079.723 | 已删除 |
| CLEAN-009 | 六个已确认完整解压的工具下载 ZIP；稳定工具链保留 | 6 | 2229702466 | 2126.41 | 已删除 |
| CLEAN-010 | 待清理文件/.tools/builder-cache | 378 | 16183252 | 15.434 | 已删除 |
| CLEAN-011 | 待清理文件/.tools/MinGit-2.55.0-64-bit.zip | 1 | 38830800 | 37.032 | 已删除 |
| CLEAN-012 | release/win-unpacked，包内版本已核实 0.4.0 | 539 | 528426319 | 503.947 | 已删除 |
| CLEAN-013-0.3.0 | release 旧 0.3.0 EXE/blockmap；远端摘要上轮已核实 | 2 | 151220127 | 144.215 | 已删除 |
| CLEAN-013-0.2.2 | release 旧 0.2.2 EXE/blockmap；远端摘要上轮已核实 | 2 | 151176660 | 144.173 | 已删除 |
| CLEAN-013-0.2.1 | release 旧 0.2.1 EXE/blockmap；远端摘要上轮已核实 | 2 | 151175259 | 144.172 | 已删除 |
| CLEAN-013-0.2.0 | release 旧 0.2.0 EXE/blockmap；远端摘要上轮已核实 | 2 | 151172987 | 144.17 | 已删除 |
| CLEAN-014-0.1.1 | 待清理文件/release 原 0.1.1 EXE/blockmap；fixes 排除 | 2 | 151134413 | 144.133 | 已删除 |
| CLEAN-014-0.1.0 | 待清理文件/release 原 0.1.0 EXE/blockmap；fixes 排除 | 2 | 151121794 | 144.121 | 已删除 |

实际删除普通文件 16595 个、逻辑字节 7916857218（7.373148 GiB）。
删除后项目普通文件 49723 个、逻辑字节 17614268260（16.404566 GiB）。
D 盘可用空间变化 7932039168 字节（包含系统其他活动影响，仅为测量差值）；清理前 18026737664、清理后 25958776832。
逐文件核验：原清单除批准删除文件外无缺失、大小/时间无变；3880 个受保护 SHA256 全部一致。
数据库、身份材料、v0.4.1、v0.4.0 核心、v0.1.2、v0.1.0 fixes、Evidence、Android 源码/APK/报告/工具链/AVD 均保留。

### 清理后 Git 状态
```text
 M README.md
 M docs/codex-next-chat-prompt.md
 M docs/execution-trace.md
 M docs/next-session-handoff.md
 M docs/user-guide.md
 M package.json
 M src/main/features/execution-trace.ts
 M src/main/features/monitoring.ts
 M src/main/features/operations.ts
 M src/main/features/workflow-runtime.ts
 M src/renderer/App.tsx
 M src/renderer/pages/AI.tsx
 M src/renderer/pages/AgentBuilder.tsx
 M src/renderer/pages/AgentStudio.tsx
 M src/renderer/pages/ExecutionRuns.tsx
 M src/renderer/pages/Monitoring.tsx
 M src/renderer/pages/SkillCenter.tsx
 M src/renderer/pages/WorkflowStudio.tsx
 M src/renderer/style.css
 M src/shared/monitoring-form.ts
 M src/shared/trace.ts
 M tests/e2e/agent-builder.spec.ts
 M tests/e2e/execution-trace.spec.ts
 M tests/e2e/skill-center.spec.ts
 M tests/e2e/tool-center.spec.ts
 M tests/execution-trace.test.ts
 M tests/operations.test.ts
 M tests/workflow.test.ts
 M "\351\241\271\347\233\256\350\277\233\347\250\213.md"
?? android-app/
?? docs/next-stage-optimization.md
?? docs/releases/v0.4.1.md
?? docs/software-overview.md
?? docs/testing/2026-10-03-monitoring.md
?? docs/testing/2026-10-03-project-cleanup.md
?? docs/testing/2026-10-03-v0.4.1-package.md
?? docs/testing/evidence/monitoring-20261003/
?? docs/testing/evidence/package-20261003/
?? tests/e2e/monitoring-mail.spec.ts
?? tests/monitoring-health.test.ts
```
清理没有删除 tracked 文件或新增监控测试，原有未提交修改保留。项目进程.md 根据本轮明确不要动的要求未追加；维护证据记录于本文件。

## 验证结果
| 检查 | 结果 |
|---|---|
| typecheck | 通过，tsc --noEmit 退出 0 |
| unit | 24 文件，256 项全部通过 |
| production build | 通过，退出 0；既有大分块提示保留 |
| Electron regression | 17 项全部通过，44.8 秒，当前源码 build 启动 |
| git diff --check | 通过，退出 0；仅既有 CRLF 提示 |
| Android 轻量检查 | 源码/Wrapper/SDK/JDK/Gradle/稳定 emulator/APK/报告/AVD 全部存在 |
| 受保护文件 | 3880 个 SHA256 最终复核仍全部一致 |
| 敏感资产 | local-test.key、受保护 SQLite、adbkey/debug.keystore 均保留；未输出秘密；敏感路径仍 ignored，无数据库/私钥/keystore tracked |

测试日志和本轮 Electron 截图位于独立临时目录 C:\Users\周周\AppData\Local\Temp\sre-cleanup-20261003-checks。项目原 test-results 与 Android 测试报告/截图摘要不变。
未运行 Android 构建。Gradle 缓存已清理，下次构建需重新解析/下载依赖；bootstrap 会重新下载工具 ZIP。
验证按要求重建 dist，共 8 个既有 dist 文件元数据更新；源码、配置、安装包、Evidence、原有截图未改动。
测试重建 Vite 缓存：1 个普通文件、1851 字节，属于正常验证输出，未再次删除。

## 最终项目大小
- 统计时间：2026-10-03T14:36:34.5486766+08:00
- 普通文件数：49724
- 逻辑大小：17614274444 字节（16.404571 GiB）；该值统计时尚未追加本节 Markdown。
- 累计删除逻辑数据：7916857218 字节（7.373148 GiB）。
- 删除完成后的 D 盘可用空间增量：7932039168 字节（7.387287 GiB）；为卷级观测，包含外部活动，不能等同精确文件物理释放。
- 本次验证后 D 盘可用空间：25958768640 字节；检查日志在 C 盘。

## 保留项与 Git 最终状态
v0.4.1 整目录、v0.4.0 EXE/blockmap/SHA256SUMS/latest.yml/builder-debug.yml、v0.1.2 EXE/blockmap/SHA256SUMS、v0.1.0 fixes-20260917 整目录均与清理前一致。各历史 SHA256SUMS、Release Notes 均保留。
Git 历史/源码/监控新增测试/所有数据库与竞赛 Evidence/Android 源码与报告/AVD/密钥材料均保留。android-app/.avd 未清理。
CLEAN-004：Android cache 42 文件、3,581,003 字节暂留，没有结束 adb。
Git 状态只新增本清理记录；此前 29 个 tracked 修改和既有 untracked 成果均保留。非预期删除 0。
```text
 M README.md
 M docs/codex-next-chat-prompt.md
 M docs/execution-trace.md
 M docs/next-session-handoff.md
 M docs/user-guide.md
 M package.json
 M src/main/features/execution-trace.ts
 M src/main/features/monitoring.ts
 M src/main/features/operations.ts
 M src/main/features/workflow-runtime.ts
 M src/renderer/App.tsx
 M src/renderer/pages/AI.tsx
 M src/renderer/pages/AgentBuilder.tsx
 M src/renderer/pages/AgentStudio.tsx
 M src/renderer/pages/ExecutionRuns.tsx
 M src/renderer/pages/Monitoring.tsx
 M src/renderer/pages/SkillCenter.tsx
 M src/renderer/pages/WorkflowStudio.tsx
 M src/renderer/style.css
 M src/shared/monitoring-form.ts
 M src/shared/trace.ts
 M tests/e2e/agent-builder.spec.ts
 M tests/e2e/execution-trace.spec.ts
 M tests/e2e/skill-center.spec.ts
 M tests/e2e/tool-center.spec.ts
 M tests/execution-trace.test.ts
 M tests/operations.test.ts
 M tests/workflow.test.ts
 M "\351\241\271\347\233\256\350\277\233\347\250\213.md"
?? android-app/
?? docs/next-stage-optimization.md
?? docs/releases/v0.4.1.md
?? docs/software-overview.md
?? docs/testing/2026-10-03-monitoring.md
?? docs/testing/2026-10-03-project-cleanup.md
?? docs/testing/2026-10-03-v0.4.1-package.md
?? docs/testing/evidence/monitoring-20261003/
?? docs/testing/evidence/package-20261003/
?? tests/e2e/monitoring-mail.spec.ts
?? tests/monitoring-health.test.ts
```

## 后续可考虑（本轮均未执行）
- Android AVD（需另行判断测试现场/状态价值，且逻辑大小不等于物理占用）
- Android SDK/JDK/Emulator 工具链
- node_modules
- 旧 Benchmark 生产端重复副本
- v0.1.0 fixes win-unpacked
- 本轮暂留 CLEAN-004，需先确认 adb 是否使用

本轮没有 commit/push/tag/GitHub Release/打新安装包、产品功能修改、远程操作或用户 AppData 清理。
