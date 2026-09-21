import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
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
import {
  PlusOutlined,
  SendOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  EditOutlined,
} from "@ant-design/icons";
import type { Snapshot } from "../../shared/types";
import type { AgentPermission, AgentSession } from "../../shared/agent";
import { agentStatusLabels, permissionLabels } from "../../shared/agent";
import { call, reportError } from "../api";
import AIScripts from "./AIScripts";

const descriptions: Record<AgentPermission, string> = {
  advice: "只分析需求，不读取主机文件或执行工具。",
  readonly: "读取文件、系统概况和 HTTP 检查；禁止写入和任意终端命令。",
  confirm: "读取自动进行；每次写入和终端命令由你审阅后确认。",
  autonomous: "发送即授权 AI 连续执行任务范围内的操作，可暂停或停止。",
};
const running = ["running", "pausing", "awaiting_approval"];
type SessionRow = AgentSession & { stepCount?: number };
export default function AI(props: { data: Snapshot; refresh: () => void }) {
  return (
    <Tabs
      defaultActiveKey="agent"
      items={[
        {
          key: "agent",
          label: "任务助手",
          children: <AgentWorkspace {...props} />,
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
function AgentWorkspace({
  data,
  refresh: refreshSnapshot,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState("");
  const [session, setSession] = useState<AgentSession>();
  const [providerId, setProvider] = useState("");
  const [permission, setPermission] = useState<AgentPermission>("readonly");
  const [root, setRoot] = useState("/");
  const [hostId, setHost] = useState("");
  const [sudo, setSudo] = useState(false);
  const [maxSteps, setMaxSteps] = useState(40);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [title, setTitle] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const refresh = () => {
    setRevision((v) => v + 1);
    refreshSnapshot();
  };
  useEffect(() => {
    if (!selected) {
      if (!providerId)
        setProvider(data.providers.find((p) => p.kind === "model")?.id ?? "");
      if (!hostId) setHost(data.hosts.find((h) => h.fingerprint)?.id ?? "");
    }
  }, [selected, data.providers, data.hosts, providerId, hostId]);
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
  useEffect(() => {
    if (session && session.id === selected) {
      setProvider(session.providerId);
      setPermission(session.permission);
      setRoot(session.target.root);
      setMaxSteps(session.maxSteps);
      if (session.target.kind === "ssh") {
        setHost(session.target.hostId);
        setSudo(session.target.sudo);
      }
    }
  }, [session?.id, selected]);
  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selected, session?.steps.length, session?.status]);
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
  const active = sessions.some((s) => running.includes(s.status));
  const canReply =
    session &&
    ["paused", "awaiting_input", "completed", "failed", "cancelled"].includes(
      session.status,
    ) &&
    session.target.kind === "ssh";
  const send = () =>
    action(async () => {
      if (selected) {
        await call("ai.session.reply", { id: selected, instruction: message });
      } else {
        const created = await call<AgentSession>("ai.session.start", {
          providerId,
          permission,
          target: { kind: "ssh", root, hostId, sudo },
          instruction: message,
          maxSteps,
        });
        setSelected(created.id);
        setSession(created);
      }
      setMessage("");
    });
  const pending =
    session?.status === "awaiting_approval"
      ? session.steps.find((s) => s.status === "pending")
      : undefined;
  const newChat = () => {
    setSelected("");
    setSession(undefined);
    setMessage("");
  };
  const pick = (s: SessionRow) => {
    setSelected(s.id);
    setSession(undefined);
    setMessage("");
  };
  const statusColor =
    session?.status === "failed" || session?.status === "unknown"
      ? "red"
      : "cyan";
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>AI 任务助手</Typography.Title>
          <p>选择服务器，在对话中完成检查、操作和验证。</p>
        </div>
        <Tag color="cyan">远程运维</Tag>
      </div>
      {loadError && (
        <Alert type="error" title="会话加载失败" description={loadError} />
      )}
      <div className="agent-layout">
        <aside className="agent-sidebar">
          <div className="agent-config">
            <div className="agent-section-heading">
              <strong>会话配置</strong>
              <Button icon={<PlusOutlined />} onClick={newChat}>
                新对话
              </Button>
            </div>
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              <label>模型</label>
              <Select
                aria-label="任务模型"
                disabled={!!selected}
                placeholder="选择模型 API"
                style={{ width: "100%" }}
                value={providerId || undefined}
                onChange={setProvider}
                options={data.providers
                  .filter((p) => p.kind === "model")
                  .map((p) => ({ value: p.id, label: p.name }))}
              />
              <label>服务器</label>
              <Select
                aria-label="目标主机"
                disabled={!!selected}
                placeholder="选择已连接并信任的服务器"
                style={{ width: "100%" }}
                value={hostId || undefined}
                onChange={setHost}
                options={data.hosts
                  .filter((h) => h.fingerprint)
                  .map((h) => ({
                    value: h.id,
                    label: `${h.name} · ${h.username}@${h.address}`,
                  }))}
              />
              {!data.hosts.some((h) => h.fingerprint) && (
                <div className="muted">
                  请先在主机管理中添加服务器、检测连接并信任指纹。
                </div>
              )}
              <label>执行权限</label>
              <Select
                aria-label="执行权限"
                disabled={!!selected}
                style={{ width: "100%" }}
                value={permission}
                onChange={setPermission}
                options={Object.entries(permissionLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
              <div className="muted">{descriptions[permission]}</div>
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: "options",
                    label: "工作目录与高级设置",
                    children: (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Input
                          aria-label="远端工作目录"
                          disabled={!!selected}
                          value={root}
                          onChange={(e) => setRoot(e.target.value)}
                          placeholder="绝对路径，例如 /opt/my-blog"
                        />
                        <Checkbox
                          disabled={!!selected}
                          checked={sudo}
                          onChange={(e) => setSudo(e.target.checked)}
                        >
                          使用已配置的 sudo
                        </Checkbox>
                        <Space>
                          <span>每轮最多步骤</span>
                          <InputNumber
                            aria-label="步骤上限"
                            disabled={!!selected}
                            min={1}
                            max={100}
                            value={maxSteps}
                            onChange={(v) => setMaxSteps(v ?? 40)}
                          />
                        </Space>
                        <div className="muted">
                          终端使用服务器账号权限，工作目录不是命令沙箱。停止不撤销已完成的变更。
                        </div>
                      </Space>
                    ),
                  },
                ]}
              />
              {selected && (
                <div className="muted">
                  当前会话配置固定；更换服务器或权限请新建对话。
                </div>
              )}
            </Space>
          </div>
          <div className="agent-history-panel">
            <div className="agent-section-heading">
              <strong>对话记录</strong>
              <span className="muted">{sessions.length}</span>
            </div>
            <nav className="agent-history" aria-label="AI 对话记录">
              {!sessions.length ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无对话"
                />
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    className={`agent-history-item ${selected === s.id ? "selected" : ""}`}
                    onClick={() => pick(s)}
                  >
                    <strong>{s.title || s.instruction.slice(0, 65)}</strong>
                    <small>
                      {permissionLabels[s.permission]} ·{" "}
                      {agentStatusLabels[s.status]} ·{" "}
                      {s.stepCount ?? s.steps.length} 步
                    </small>
                  </button>
                ))
              )}
            </nav>
          </div>
        </aside>
        <section className="agent-chat" aria-label="AI 对话">
          <header className="agent-chat-header">
            <div>
              <strong>
                {session?.title ||
                  session?.instruction.slice(0, 60) ||
                  "新对话"}
              </strong>
              {session && (
                <div className="muted">
                  {session.target.kind === "ssh"
                    ? (data.hosts.find(
                        (h) =>
                          session.target.kind === "ssh" &&
                          h.id === session.target.hostId,
                      )?.name ?? "远程服务器")
                    : "旧版本本机记录"}{" "}
                  · {session.target.root}
                </div>
              )}
            </div>
            <Space wrap>
              {session && (
                <>
                  <Tag color={statusColor}>
                    {agentStatusLabels[session.status]}
                  </Tag>
                  <Button
                    aria-label="重命名对话"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setTitle(
                        session.title || session.instruction.slice(0, 80),
                      );
                      setRenameOpen(true);
                    }}
                  />
                  {["running", "awaiting_approval", "awaiting_input"].includes(
                    session.status,
                  ) && (
                    <Button
                      icon={<PauseOutlined />}
                      aria-label="暂停"
                      disabled={busy}
                      onClick={() =>
                        action(() => call("ai.session.pause", { id: selected }))
                      }
                    >
                      暂停
                    </Button>
                  )}
                  {session.status === "paused" && (
                    <Button
                      icon={<PlayCircleOutlined />}
                      aria-label="继续"
                      disabled={busy || active || session.target.kind !== "ssh"}
                      onClick={() =>
                        action(() =>
                          call("ai.session.resume", { id: selected }),
                        )
                      }
                    >
                      继续
                    </Button>
                  )}
                  {[...running, "paused", "awaiting_input"].includes(
                    session.status,
                  ) && (
                    <Button
                      danger
                      disabled={busy}
                      onClick={() =>
                        action(() => call("ai.session.stop", { id: selected }))
                      }
                    >
                      停止任务
                    </Button>
                  )}
                  {["completed", "failed", "cancelled"].includes(
                    session.status,
                  ) && (
                    <Button
                      size="small"
                      onClick={() =>
                        Modal.confirm({
                          title: "删除本地对话记录？",
                          content: "生成的文件和远端服务不会删除。",
                          onOk: () =>
                            action(async () => {
                              await call("ai.session.delete", { id: selected });
                              newChat();
                            }),
                        })
                      }
                    >
                      删除
                    </Button>
                  )}
                </>
              )}
            </Space>
          </header>
          <div
            ref={transcript}
            className="agent-transcript"
            aria-label="执行过程"
          >
            {!session ? (
              <div className="agent-welcome">
                <Typography.Title level={3}>
                  今天需要处理什么？
                </Typography.Title>
                <p>检查服务器环境、分析故障，或描述你要部署的应用。</p>
                <Button
                  onClick={() =>
                    setMessage(
                      "帮我查看这台主机已安装的软件与配置环境，不修改系统。",
                    )
                  }
                >
                  检查服务器环境
                </Button>
              </div>
            ) : (
              <>
                <div className="agent-message user">
                  <small>你</small>
                  <div className="prose">{session.instruction}</div>
                </div>
                {session.steps.map((step, index) => {
                  const task = step.taskId
                    ? data.tasks.find((t) => t.id === step.taskId)
                    : undefined;
                  if (step.summary === "用户补充")
                    return (
                      <div key={step.id} className="agent-message user">
                        <small>你</small>
                        <div className="prose">{step.output}</div>
                      </div>
                    );
                  if (["助手回复", "助手提问"].includes(step.summary))
                    return (
                      <div key={step.id} className="agent-message assistant">
                        <small>AI</small>
                        <div className="prose">{step.output}</div>
                      </div>
                    );
                  return (
                    <div className="agent-message assistant" key={step.id}>
                      <small>AI · 第 {index + 1} 步</small>
                      <Collapse
                        size="small"
                        items={[
                          {
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
                                      rejected: "未执行",
                                    }[step.status]
                                  }
                                </Tag>
                                <span>{step.summary}</span>
                              </Space>
                            ),
                            children: (
                              <>
                                {step.call && (
                                  <pre className="output">
                                    {JSON.stringify(step.call, null, 2)}
                                  </pre>
                                )}
                                {task && (
                                  <>
                                    <Space>
                                      <Tag>{task.status}</Tag>
                                      <span>
                                        退出码：{task.exitCode ?? "—"}
                                      </span>
                                      <Button
                                        size="small"
                                        onClick={() =>
                                          action(() =>
                                            call("task.reconcile", {
                                              id: task.id,
                                            }),
                                          )
                                        }
                                      >
                                        核实远端状态
                                      </Button>
                                      {[
                                        "queued",
                                        "running",
                                        "unknown",
                                      ].includes(task.status) && (
                                        <Button
                                          size="small"
                                          danger
                                          onClick={() =>
                                            Modal.confirm({
                                              title: "终止此远端操作？",
                                              content:
                                                "已经发生的变更不会撤销。",
                                              onOk: () =>
                                                action(() =>
                                                  call("task.cancel", {
                                                    id: task.id,
                                                  }),
                                                ),
                                            })
                                          }
                                        >
                                          终止远端操作
                                        </Button>
                                      )}
                                    </Space>
                                    <pre className="output">
                                      {task.logs || "等待远端日志…"}
                                    </pre>
                                  </>
                                )}
                                {step.output && (
                                  <pre className="output">{step.output}</pre>
                                )}
                              </>
                            ),
                          },
                        ]}
                      />
                    </div>
                  );
                })}
                {pending && (
                  <div className="agent-approval">
                    <strong>确认本次操作</strong>
                    <p>{pending.summary}</p>
                    <pre className="output">
                      {JSON.stringify(pending.call, null, 2)}
                    </pre>
                    <Space>
                      <Button
                        type="primary"
                        loading={busy}
                        onClick={() =>
                          action(() =>
                            call("ai.session.approve", {
                              id: selected,
                              stepId: pending.id,
                              approved: true,
                            }),
                          )
                        }
                      >
                        允许本次操作
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          action(() =>
                            call("ai.session.approve", {
                              id: selected,
                              stepId: pending.id,
                              approved: false,
                            }),
                          )
                        }
                      >
                        拒绝
                      </Button>
                    </Space>
                  </div>
                )}
                {session.steps.at(-1)?.output !== session.summary && (
                  <div className="agent-message assistant">
                    <small>AI · {agentStatusLabels[session.status]}</small>
                    <div className="prose">{session.summary}</div>
                  </div>
                )}
                {session.status === "unknown" && (
                  <Button
                    onClick={() =>
                      Modal.confirm({
                        title: "已核实实际状态？",
                        content:
                          "先展开本会话相关远端操作，核实并结束未知操作后再确认；不会自动重放。",
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
              </>
            )}
          </div>
          <footer className="agent-composer">
            <Input.TextArea
              aria-label="任务指令"
              rows={3}
              maxLength={30000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={!!selected && !canReply}
              placeholder={
                selected
                  ? "补充需求或回答问题，继续当前对话…"
                  : "发送需求，例如：查看服务器已安装的软件和运行服务"
              }
              onKeyDown={(e) => {
                if (
                  (e.ctrlKey || e.metaKey) &&
                  e.key === "Enter" &&
                  !busy &&
                  !active &&
                  message.trim() &&
                  (canReply || (!selected && providerId && hostId && root))
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="agent-composer-actions">
              <span className="muted">
                相关内容会脱敏后发送模型 · Ctrl + Enter 发送
              </span>
              <Button
                type="primary"
                icon={<SendOutlined />}
                aria-label={
                  selected
                    ? "发送并继续"
                    : permission === "autonomous"
                      ? "授权并发送"
                      : "发送"
                }
                loading={busy}
                disabled={
                  active ||
                  !message.trim() ||
                  (selected ? !canReply : !providerId || !hostId || !root)
                }
                onClick={send}
              >
                {selected
                  ? "发送并继续"
                  : permission === "autonomous"
                    ? "授权并发送"
                    : "发送"}
              </Button>
            </div>
          </footer>
        </section>
      </div>
      <Modal
        title="重命名对话"
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        confirmLoading={busy}
        okButtonProps={{ disabled: !title.trim() }}
        onOk={() =>
          action(async () => {
            await call("ai.session.rename", { id: selected, title });
            setRenameOpen(false);
          })
        }
      >
        <Input
          aria-label="对话名称"
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </Modal>
    </>
  );
}
