# SRE 运维工作台

Windows 中文桌面运维软件：通过 SSH 管理 Linux，部署 Node.js / Python / 前端项目，安装 Prometheus 监控告警，并使用内置 Agent 执行诊断、部署与修复。

## 使用

v0.4.0 竞赛版已实现 Agent Studio、Tool Center、Skill Center、Agent Builder、Workflow Studio、Risk Engine、Execution Trace 与真实 Benchmark。AI 支持四档权限、可命名会话、暂停／继续和持久任务恢复。操作记录统一在 [项目进程.md](项目进程.md)，后续开发先读[当前交接](docs/next-session-handoff.md)和[新会话启动提示词](docs/codex-next-chat-prompt.md)。

项目源码已公开：[GitHub 仓库](https://github.com/zhouzhouu07/sre-workbench)。可从 [GitHub Releases 查看已发布的 Windows 安装包](https://github.com/zhouzhouu07/sre-workbench/releases)，下载时请核对对应版本说明及 SHA256；源码更新不代表旧发布包已包含最新修复。

安装 [SRE.Workbench.Setup.0.4.1.exe](https://github.com/zhouzhouu07/sre-workbench/releases/download/v0.4.1/SRE.Workbench.Setup.0.4.1.exe)（本地构建名 `release/v0.4.1/SRE Workbench Setup 0.4.1.exe`），或运行同目录 `win-unpacked/SRE Workbench.exe`。普通使用无需安装 Node.js、Python、Git 或 Docker；Git 已随软件携带，远端缺少 Docker 时由确认后的部署任务安装。

当前版本 [v0.4.1 更新说明](docs/releases/v0.4.1.md)；[v0.4.1 发行页](https://github.com/zhouzhouu07/sre-workbench/releases/tag/v0.4.1)。历史 [v0.4.0](https://github.com/zhouzhouu07/sre-workbench/releases/tag/v0.4.0) 保留。

**v0.4.1** 包含监控、Workflow／Trace稳定性修复和桌面界面改进。2026-10-06按用户指示将10月3日已构建、验收的安装包转为正式发行；101项构建输入与现有产品代码、安装包摘要一致，本轮不重复回归。[更新说明](docs/releases/v0.4.1.md)／[原打包验收](docs/testing/2026-10-03-v0.4.1-package.md)／[发行核验](docs/testing/2026-10-06-v0.4.1-release.md)。

1. 在「主机管理」添加 Linux 地址、SSH 用户和密码或私钥，点击连接检测，核实并信任 SSH 指纹。
2. 点击管理查看资源、进程、系统服务、日志、容器及 SFTP 文件。终端支持多标签。
3. 在「应用部署」新建方案，选择本地源码目录或 HTTPS Git 仓库，指定模板、命令、端口与健康检查路径。保存后点击部署，确认变更，进入任务中心查看执行。
4. 在「监控告警」选择监控服务器和各主机内网 IPv4 地址，设置 Grafana 初始密码、告警阈值、邮件或 Webhook，确认部署。打开 Grafana 时软件自动建立本机 SSH 隧道。
5. 在「设置」配置模型 API。「AI 助手 → 任务助手」选择分析、只读、确认或自主执行权限及已信任的服务器，提交具体需求；任务中读取的内容会脱敏后发送模型。原外部 Agent 与脚本草稿流程保留在「脚本助手（兼容接口）」。详见使用说明的权限边界。
6. 在「Agent Studio」管理工具／技能包，构建 Agent、编排 Workflow、查看 Runs 和导出 Trace；Benchmark 会在所选测试服务器创建隔离资源并消耗模型额度。

详细操作、远端要求及边界见 [使用说明](docs/user-guide.md)，外部服务协议见 [Agent API](docs/agent-api.md)。

项目架构、功能与验证进展见 [SRE 运维工作台博客](docs/blog/2026-09-17-sre-workbench-architecture.md)。

## 源码开发

建议 Node.js 24、pnpm 11，Windows x64。

```powershell
pnpm install --frozen-lockfile
pnpm prepare:git
pnpm dev
```

```powershell
pnpm build
pnpm package
```

依赖版本已锁定在 `pnpm-lock.yaml`。`prepare:git` 从 Git for Windows 官方下载固定版本 MinGit 并核对 SHA256。安装包包含 Git 的许可证。构建目录 `dist`，发行目录 `release`；个人数据保存在 Windows 应用数据目录内，与源码分开。

## 项目结构

- `src/main/core`：SQLite、加密凭据、SSH/SFTP、确认令牌和持久远端任务。
- `src/main/features`：部署与监控、AI/Agent、Tool/Skill Registry、Agent Builder、Workflow、Risk、Trace 和 Benchmark。
- `src/renderer`：中文桌面页面、终端、脚本编辑器。
- `examples`：前端、Node.js、Python 和外部 Agent 示例。

## 当前交付边界

当前能力以 Rocky Linux 9.4 的真实部署、自愈、Compose、恢复实验和自动化回归为依据，具体结果见[真实 Benchmark 报告](docs/testing/competition-agent-benchmark.md)。36 个非接口阻塞案例中 A/B/C 分别通过 10/12、8/12、10/12，误报成功均为 0；样本量有限，不能宣称 Studio 在总体成功率上稳定优于通用 Agent，也不能保证任意运维任务全自动完成。证书签发、外部通知和其他发行版仍需目标环境验证。安装包未配置商业代码签名证书。

支持 Rocky Linux 9.4、Ubuntu 22.04/24.04、Debian 12 x86_64，主机需能访问软件源和镜像仓库。模型接口支持 OpenAI 与 Anthropic 兼容协议（包括 DeepSeek `/anthropic`）；OpenAI 兼容任务助手要求支持 JSON 输出。列表删除仅移除本地配置或记录，不卸载远端服务。暂不含 Zabbix、Kubernetes、多人权限、数据库迁移。AI 自主执行须由用户选择权限并提交任务，终端不是目录沙箱。应用回退不回退持久化数据。
