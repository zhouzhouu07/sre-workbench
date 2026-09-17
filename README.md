# SRE 运维工作台

Windows 中文桌面运维软件：通过 SSH 管理 Linux，部署 Node.js / Python / 前端项目，安装 Prometheus 监控告警，并使用模型或外部 Agent 辅助分析和编写脚本。

## 使用

安装 `release/SRE Workbench Setup 0.1.0.exe`，或运行 `release/win-unpacked/SRE Workbench.exe`。普通使用无需安装 Node.js、Python、Git 或 Docker；Git 已随软件携带，远端缺少 Docker 时由确认后的部署任务安装。

1. 在「主机管理」添加 Linux 地址、SSH 用户和密码或私钥，点击连接检测，核实并信任 SSH 指纹。
2. 点击管理查看资源、进程、系统服务、日志、容器及 SFTP 文件。终端支持多标签。
3. 在「应用部署」新建方案，选择本地源码目录或 HTTPS Git 仓库，指定模板、命令、端口与健康检查路径。保存后点击部署，确认变更，进入任务中心查看执行。
4. 在「监控告警」选择监控服务器和各主机内网 IPv4 地址，设置 Grafana 初始密码、告警阈值、邮件或 Webhook，确认部署。打开 Grafana 时软件自动建立本机 SSH 隧道。
5. 在「设置」配置模型 API 或外部 Agent。AI 助手只发送你选定、预览后的上下文；返回脚本需要另一次明确确认才能执行。

详细操作、远端要求及边界见 [使用说明](docs/user-guide.md)，外部服务协议见 [Agent API](docs/agent-api.md)。

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
- `src/main/features`：源码传输、部署模板、监控配置、AI/Agent 接口。
- `src/renderer`：中文桌面页面、终端、脚本编辑器。
- `examples`：前端、Node.js、Python 和外部 Agent 示例。

## 当前交付边界

当前为可安装的首版实现。按项目要求，本轮以完成功能和打包为先，未运行自动化回归套件；真实 Linux 上的部署、证书签发、监控和通知需要在实际使用阶段联调。安装包未配置商业代码签名证书。

支持 Ubuntu 22.04/24.04、Debian 12 x86_64，主机需能访问软件源和镜像仓库。暂不含 Zabbix、Kubernetes、多人权限、无人确认的 AI 执行、数据库迁移。应用回退不回退持久化数据。
