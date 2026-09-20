import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { Snapshot } from "../../shared/types";
import type {
  AgentPermission,
  AgentSession,
  AgentTarget,
} from "../../shared/agent";
import { agentStatusLabels, permissionLabels } from "../../shared/agent";
import { call, reportError } from "../api";
import AIScripts from "./AIScripts";

const descriptions: Record<AgentPermission, string> = {
  advice: "只分析需求并给出建议，不读取文件或执行工具。",
  readonly:
    "允许读取工作目录文件、固定系统信息和 HTTP 回环检查；禁止写文件和任意终端命令。",
  confirm:
    "读取自动进行；每次写文件、创建目录和终端命令先展示内容，由你确认后执行。",
  autonomous:
    "提交任务即授权 AI 连续读写文件、执行命令和验证结果，无需逐步确认；你可随时停止后续操作。",
};
type SessionRow = AgentSession & { stepCount?: number };
export default function AI(props: { data: Snapshot; refresh: () => void }) {
  return (
    <Tabs
      defaultActiveKey="agent"
      items={[
        {
          key: "agent",
          label: "任务助手",
          children: <AgentWorkspace data={props.data} />,
        },
        {
          key: "scripts",
          label: "脚本助手（兼容接口）",
          children: <AIScripts {...props} />,
        },
      ]}
    />
  );
}
function AgentWorkspace({ data }: { data: Snapshot }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState("");
  const [session, setSession] = useState<AgentSession>();
  const [providerId, setProvider] = useState("");
  const [permission, setPermission] = useState<AgentPermission>("readonly");
  const [targetKind, setTargetKind] = useState<"local" | "ssh">("local");
  const [localRoot, setLocalRoot] = useState("");
  const [remoteRoot, setRemoteRoot] = useState("");
  const [hostId, setHost] = useState("");
  const [sudo, setSudo] = useState(false);
  const [maxSteps, setMaxSteps] = useState(40);
  const [instruction, setInstruction] = useState("");
  const [followup, setFollowup] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    let live = true,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const [rows, detail] = await Promise.all([
          call<SessionRow[]>("ai.session.list", {}),
          selected
            ? call<AgentSession>("ai.session.get", { id: selected })
            : Promise.resolve(undefined),
        ]);
        if (live) {
          setSessions(rows);
          setSession(detail);
          setLoadError("");
        }
      } catch (e) {
        if (live) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected, revision]);
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const active = sessions.some((s) =>
    ["running", "awaiting_approval"].includes(s.status),
  );
  const root = targetKind === "local" ? localRoot : remoteRoot;
  const start = () =>
    action(async () => {
      const target: AgentTarget =
        targetKind === "local"
          ? { kind: "local", root }
          : { kind: "ssh", root, hostId, sudo };
      const created = await call<AgentSession>("ai.session.start", {
        providerId,
        permission,
        target,
        instruction,
        maxSteps,
      });
      setSelected(created.id);
      setSession(created);
      setFollowup("");
    });
  const approve = (approved: boolean, stepId: string) =>
    action(() =>
      call("ai.session.approve", { id: selected, stepId, approved }),
    );
  const pending =
    session?.status === "awaiting_approval"
      ? session.steps.find((s) => s.status === "pending")
      : undefined;
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>AI 任务助手</Typography.Title>
          <p>提出需求，选择权限，跟踪从文件创建到运行验证的每一步。</p>
        </div>
        <Tag color="cyan">Windows · SSH Linux</Tag>
      </div>
      {loadError && (
        <Alert type="error" title="会话加载失败" description={loadError} />
      )}
      <div className="agent-layout">
        <div className="agent-sidebar">
          <Card title="新任务" size="small">
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <Select
                aria-label="任务模型"
                placeholder="选择模型 API"
                style={{ width: "100%" }}
                value={providerId || undefined}
                onChange={setProvider}
                options={data.providers
                  .filter((p) => p.kind === "model")
                  .map((p) => ({ value: p.id, label: p.name }))}
              />
              {!data.providers.some((p) => p.kind === "model") && (
                <Alert
                  type="info"
                  title="请先到设置添加模型 API"
                  description="现有外部 HTTP Agent v1 请使用脚本助手。"
                />
              )}
              <Select
                aria-label="执行权限"
                value={permission}
                onChange={setPermission}
                style={{ width: "100%" }}
                options={Object.entries(permissionLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
              <div className="muted">{descriptions[permission]}</div>
              <Select
                aria-label="执行环境"
                value={targetKind}
                onChange={setTargetKind}
                style={{ width: "100%" }}
                options={[
                  { value: "local", label: "Windows 本机" },
                  { value: "ssh", label: "SSH Linux 服务器" },
                ]}
              />
              {targetKind === "local" ? (
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    aria-label="本机工作目录"
                    value={localRoot}
                    readOnly
                    placeholder="选择已存在的工作目录"
                  />
                  <Button
                    onClick={() =>
                      action(async () => {
                        const dir = await call<string | null>("dialog.open", {
                          mode: "directory",
                        });
                        if (dir) setLocalRoot(dir);
                      })
                    }
                  >
                    选择
                  </Button>
                </Space.Compact>
              ) : (
                <>
                  <Select
                    aria-label="目标主机"
                    placeholder="选择已信任的主机"
                    style={{ width: "100%" }}
                    value={hostId || undefined}
                    onChange={setHost}
                    options={data.hosts.map((h) => ({
                      value: h.id,
                      label: `${h.name} · ${h.username}@${h.address}`,
                      disabled: !h.fingerprint,
                    }))}
                  />
                  <Input
                    aria-label="远端工作目录"
                    value={remoteRoot}
                    onChange={(e) => setRemoteRoot(e.target.value)}
                    placeholder="绝对路径，例如 /opt/my-blog"
                  />
                  <Checkbox
                    checked={sudo}
                    onChange={(e) => setSudo(e.target.checked)}
                  >
                    允许使用该主机已配置的 sudo
                  </Checkbox>
                </>
              )}
              {["confirm", "autonomous"].includes(permission) && (
                <Alert
                  type="warning"
                  title="终端按系统账号权限执行"
                  description="工作目录不是命令沙箱。终端可安装依赖、启动服务并访问账号有权访问的资源；停止不会撤销已完成的变更。"
                />
              )}
              <Input.TextArea
                aria-label="任务需求"
                rows={6}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例如：采用 Nginx、Flask、Python 搭建个人博客，页面简洁。创建完整项目、启动服务、验证首页并告诉我访问地址。"
                maxLength={30000}
              />
              <Space>
                <span>每轮最多步骤</span>
                <InputNumber
                  aria-label="步骤上限"
                  min={1}
                  max={100}
                  value={maxSteps}
                  onChange={(v) => setMaxSteps(v ?? 40)}
                />
              </Space>
              <div className="muted">
                提交后，需求和工具读取的相关内容会脱敏后发送到所选模型，执行过程保存在本机。请选定本任务需要的目录。
              </div>
              <Button
                type="primary"
                block
                loading={busy}
                disabled={
                  active ||
                  !providerId ||
                  !instruction.trim() ||
                  !root ||
                  (targetKind === "ssh" && !hostId)
                }
                onClick={start}
              >
                {permission === "autonomous"
                  ? "授权并开始自主执行"
                  : "开始任务"}
              </Button>
            </Space>
          </Card>
          <Card title="任务历史" size="small">
            {!sessions.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无 AI 任务"
              />
            ) : (
              <div className="agent-history">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    className={`agent-history-item ${selected === s.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(s.id);
                      setSession(undefined);
                      setFollowup("");
                    }}
                  >
                    <strong>{s.instruction.slice(0, 65)}</strong>
                    <small>
                      {permissionLabels[s.permission]} ·{" "}
                      {agentStatusLabels[s.status]} ·{" "}
                      {s.stepCount ?? s.steps.length} 步
                    </small>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
        <Card
          className="agent-detail"
          title={session ? "任务执行记录" : "从一个具体需求开始"}
          extra={
            session && (
              <Space>
                <Tag>{permissionLabels[session.permission]}</Tag>
                <Tag
                  color={
                    session.status === "failed" || session.status === "unknown"
                      ? "red"
                      : "cyan"
                  }
                >
                  {agentStatusLabels[session.status]}
                </Tag>
              </Space>
            )
          }
        >
          {!session ? (
            <Empty description="在左侧提交任务，或选择历史记录查看结果" />
          ) : (
            <>
              <Typography.Paragraph className="prose">
                {session.instruction}
              </Typography.Paragraph>
              <div className="muted agent-target">
                {session.target.kind === "local"
                  ? "Windows 本机"
                  : `SSH：${session.target.hostId}`}{" "}
                · {session.target.root}
              </div>
              <Space className="toolbar" wrap>
                {["running", "awaiting_approval", "awaiting_input"].includes(
                  session.status,
                ) && (
                  <Button
                    danger
                    loading={busy}
                    onClick={() =>
                      action(() => call("ai.session.stop", { id: selected }))
                    }
                  >
                    停止任务
                  </Button>
                )}
                {session.status === "unknown" && (
                  <Button
                    onClick={() =>
                      Modal.confirm({
                        title: "已核实实际状态？",
                        content:
                          "请先检查本机进程、文件及关联远端任务，确认没有未知操作仍在执行。此操作仅结束会话，不会回滚或重放命令。",
                        onOk: () =>
                          action(() =>
                            call("ai.session.resolve", { id: selected }),
                          ),
                      })
                    }
                  >
                    我已核实实际状态
                  </Button>
                )}
                {["completed", "failed", "cancelled"].includes(
                  session.status,
                ) && (
                  <Button
                    onClick={() =>
                      Modal.confirm({
                        title: "删除本地 AI 记录？",
                        content: "生成的文件、服务和远端任务不会删除。",
                        onOk: () =>
                          action(async () => {
                            await call("ai.session.delete", { id: selected });
                            setSelected("");
                            setSession(undefined);
                          }),
                      })
                    }
                  >
                    删除记录
                  </Button>
                )}
              </Space>
              <Alert
                type={
                  session.status === "failed" || session.status === "unknown"
                    ? "warning"
                    : "info"
                }
                title={agentStatusLabels[session.status]}
                description={<div className="prose">{session.summary}</div>}
              />
              {pending && (
                <Card
                  className="agent-approval"
                  size="small"
                  title="确认本次操作"
                >
                  <p>{pending.summary}</p>
                  <pre className="output">
                    {JSON.stringify(pending.call, null, 2)}
                  </pre>
                  <Space>
                    <Button
                      type="primary"
                      loading={busy}
                      onClick={() => approve(true, pending.id)}
                    >
                      允许本次操作
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => approve(false, pending.id)}
                    >
                      拒绝
                    </Button>
                  </Space>
                </Card>
              )}
              <div className="agent-steps">
                <Collapse
                  items={session.steps.map((step, index) => ({
                    key: step.id,
                    label: (
                      <Space wrap>
                        <Tag
                          color={
                            step.status === "failed" ||
                            step.status === "rejected"
                              ? "red"
                              : step.status === "succeeded"
                                ? "green"
                                : "blue"
                          }
                        >
                          {
                            {
                              thinking: "分析",
                              pending: "等待",
                              running: "执行",
                              succeeded: "成功",
                              failed: "失败",
                              rejected: "已拒绝",
                            }[step.status]
                          }
                        </Tag>
                        <span>
                          {index + 1}. {step.summary}
                        </span>
                        {session.verification.includes(step.id) && (
                          <Tag color="green">模型引用的验证</Tag>
                        )}
                      </Space>
                    ),
                    children: (
                      <>
                        <div className="muted">
                          {new Date(step.createdAt).toLocaleString()} ·{" "}
                          {step.id}
                        </div>
                        {step.call && (
                          <pre className="output">
                            {JSON.stringify(step.call, null, 2)}
                          </pre>
                        )}
                        {step.taskId && (
                          <p>
                            关联远端任务：
                            <Typography.Text copyable>
                              {step.taskId}
                            </Typography.Text>
                            （可在任务中心查看）
                          </p>
                        )}
                        {step.output && (
                          <pre className="output">{step.output}</pre>
                        )}
                      </>
                    ),
                  }))}
                />
              </div>
              {["awaiting_input", "completed", "failed", "cancelled"].includes(
                session.status,
              ) && (
                <div className="agent-followup">
                  <Input.TextArea
                    aria-label="补充任务指令"
                    value={followup}
                    onChange={(e) => setFollowup(e.target.value)}
                    rows={3}
                    maxLength={30000}
                    placeholder="回答问题或补充需求。继续使用本会话的权限和目标。"
                  />
                  <Button
                    type="primary"
                    loading={busy}
                    disabled={!followup.trim() || active}
                    onClick={() =>
                      action(async () => {
                        await call("ai.session.reply", {
                          id: selected,
                          instruction: followup,
                        });
                        setFollowup("");
                      })
                    }
                  >
                    发送并继续
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
