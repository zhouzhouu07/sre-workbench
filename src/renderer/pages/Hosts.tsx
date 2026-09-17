import { useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined, ReloadOutlined, CodeOutlined } from "@ant-design/icons";
import type {
  Host,
  Snapshot,
  FileEntry,
  ExecutionPreview,
} from "../../shared/types";
import { call, reportError } from "../api";
import Terminal from "../components/Terminal";
import ScriptEditor from "../components/ScriptEditor";
import Metrics, { type HostMetrics } from "../components/Metrics";

export default function Hosts({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState<Host | null | undefined>();
  const [form] = Form.useForm();
  const [selected, setSelected] = useState<Host>();
  const [kind, setKind] = useState("overview");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<HostMetrics>();
  const [terminals, setTerminals] = useState<{ key: string; host: Host }[]>([]);
  const [terminalKey, setTerminalKey] = useState("");
  const [unit, setUnit] = useState("");
  const [actionPreview, setActionPreview] = useState<ExecutionPreview>();
  const [filePath, setFilePath] = useState("/tmp");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [editingFile, setEditingFile] = useState<{
    path: string;
    content: string;
  }>();
  const authType = Form.useWatch("authType", form);
  const edit = (host: Host | null) => {
    form.resetFields();
    form.setFieldsValue(
      host ?? {
        port: 22,
        username: "root",
        authType: "password",
        group: "默认分组",
        tags: [],
      },
    );
    setEditing(host);
  };
  const save = async () => {
    try {
      const v = await form.validateFields();
      await call("host.save", { ...v, id: editing?.id, tags: v.tags ?? [] });
      setEditing(undefined);
      refresh();
      void message.success("主机已保存");
    } catch (e) {
      if (e instanceof Error) reportError(e);
    }
  };
  const connect = async (host: Host) => {
    setLoading(true);
    try {
      const probe = await call<{ fingerprint: string }>("host.probe", {
        id: host.id,
      });
      if (!host.fingerprint) {
        Modal.confirm({
          title: "核实 SSH 主机指纹",
          content: (
            <>
              <p>
                {host.address}:{host.port}
              </p>
              <code style={{ wordBreak: "break-all" }}>
                {probe.fingerprint}
              </code>
              <p>请通过可信渠道核对后信任此主机。</p>
            </>
          ),
          okText: "信任并连接",
          onOk: async () => {
            await call("host.trust", {
              id: host.id,
              fingerprint: probe.fingerprint,
            });
            await call("host.check", { id: host.id });
            refresh();
            void message.success("SSH 连接成功");
          },
        });
      } else {
        await call("host.check", { id: host.id });
        void message.success("SSH 连接成功");
      }
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };
  const inspect = async (host: Host, k = kind) => {
    setSelected(host);
    setKind(k);
    setLoading(true);
    setOutput("");
    setMetrics(undefined);
    try {
      const r = await call<any>("inspect", {
        hostId: host.id,
        kind: k,
        ...(k === "journal" && unit ? { unit } : {}),
      });
      setOutput(r.stdout + (r.stderr ? "\n" + r.stderr : ""));
      if (k === "overview") {
        const m = await call<any>("inspect", {
          hostId: host.id,
          kind: "metrics",
        });
        if (m.code === 0) setMetrics(JSON.parse(m.stdout));
      }
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };
  const listFiles = async (path = filePath) => {
    if (!selected) return;
    try {
      setFiles(await call("file.list", { hostId: selected.id, path }));
      setFilePath(path);
    } catch (e) {
      reportError(e);
    }
  };
  const performAction = async (action: string) => {
    try {
      setActionPreview(
        await call(
          kind === "containers" ? "container.action" : "service.action",
          {
            hostId: selected!.id,
            ...(kind === "containers" ? { id: unit } : { unit }),
            action,
          },
        ),
      );
    } catch (e) {
      reportError(e);
    }
  };
  const terminal = (host: Host) => {
    const key = crypto.randomUUID();
    setTerminals((t) => [...t, { key, host }]);
    setTerminalKey(key);
  };
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>主机管理</Typography.Title>
          <p>通过 SSH 安全连接你的 Linux 基础设施</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => edit(null)}
        >
          添加主机
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={data.hosts}
        pagination={false}
        locale={{ emptyText: "还没有主机，添加第一台 Linux 主机开始运维" }}
        columns={[
          {
            title: "主机",
            dataIndex: "name",
            render: (v, h) => (
              <>
                <strong>{v}</strong>
                <div className="muted mono">
                  {h.username}@{h.address}:{h.port}
                </div>
              </>
            ),
          },
          { title: "分组", dataIndex: "group" },
          {
            title: "标签",
            dataIndex: "tags",
            render: (tags) => tags.map((t: string) => <Tag key={t}>{t}</Tag>),
          },
          {
            title: "SSH 信任",
            dataIndex: "fingerprint",
            render: (f) => (
              <Tag color={f ? "green" : "gold"}>
                {f ? "已保存指纹" : "待核实"}
              </Tag>
            ),
          },
          {
            title: "操作",
            render: (_, h) => (
              <Space wrap>
                <Button
                  size="small"
                  loading={loading}
                  onClick={() => connect(h)}
                >
                  连接检测
                </Button>
                <Button size="small" onClick={() => inspect(h)}>
                  管理
                </Button>
                <Button
                  size="small"
                  icon={<CodeOutlined />}
                  onClick={() => terminal(h)}
                >
                  终端
                </Button>
                <Button type="link" onClick={() => edit(h)}>
                  编辑
                </Button>
                <Popconfirm
                  title={`删除主机 ${h.name} 的本地配置？`}
                  onConfirm={() =>
                    call("host.delete", { id: h.id })
                      .then(refresh)
                      .catch(reportError)
                  }
                >
                  <Button type="link" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {terminals.length > 0 && (
        <div className="terminal-panel">
          <Tabs
            type="editable-card"
            hideAdd
            activeKey={terminalKey}
            onChange={setTerminalKey}
            onEdit={(key) => {
              setTerminals((t) => t.filter((x) => x.key !== key));
              if (key === terminalKey)
                setTerminalKey(terminals.find((t) => t.key !== key)?.key ?? "");
            }}
            items={terminals.map((t) => ({
              key: t.key,
              label: t.host.name,
              children: <Terminal hostId={t.host.id} />,
            }))}
          />
        </div>
      )}
      <Modal
        title={editing ? "编辑主机" : "添加主机"}
        open={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        onOk={save}
        okText="保存"
        width={620}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="主机名称"
            rules={[{ required: true, message: "请输入主机名称" }]}
          >
            <Input placeholder="例如：生产 Web 01" />
          </Form.Item>
          <div className="two-col">
            <Form.Item
              name="address"
              label="主机地址"
              rules={[{ required: true, message: "请输入主机地址" }]}
            >
              <Input placeholder="IP 或域名" />
            </Form.Item>
            <Form.Item
              name="port"
              label="SSH 端口"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={65535} />
            </Form.Item>
          </div>
          <div className="two-col">
            <Form.Item
              name="username"
              label="SSH 用户"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="group" label="分组">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name="authType" label="认证方式">
            <Select
              options={[
                { value: "password", label: "密码" },
                { value: "key", label: "私钥" },
              ]}
            />
          </Form.Item>
          {authType === "key" ? (
            <>
              <Form.Item name="privateKey" label="私钥内容">
                <Input.TextArea
                  rows={5}
                  placeholder={
                    editing
                      ? "留空保留原私钥"
                      : "-----BEGIN OPENSSH PRIVATE KEY-----"
                  }
                />
              </Form.Item>
              <Form.Item name="passphrase" label="私钥口令">
                <Input.Password />
              </Form.Item>
            </>
          ) : (
            <Form.Item name="password" label="登录密码">
              <Input.Password placeholder={editing ? "留空保留原密码" : ""} />
            </Form.Item>
          )}
          <Form.Item name="sudoPassword" label="sudo 密码">
            <Input.Password placeholder="使用 sudo 且需要密码时填写" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        title={selected?.name}
        width="85%"
        open={!!selected}
        onClose={() => setSelected(undefined)}
        destroyOnHidden
      >
        <Tabs
          activeKey={kind}
          onChange={(k) => {
            setKind(k);
            if (k === "files") {
              void listFiles();
            } else if (selected) void inspect(selected, k);
          }}
          items={[
            ["overview", "系统概览"],
            ["processes", "进程"],
            ["services", "系统服务"],
            ["journal", "系统日志"],
            ["containers", "容器"],
            ["files", "文件管理"],
          ].map(([key, label]) => ({ key, label }))}
        />
        {kind === "overview" && metrics && <Metrics value={metrics} />}
        {kind === "containers" && (
          <Button
            disabled={!unit}
            onClick={() =>
              call<any>("inspect", {
                hostId: selected!.id,
                kind: "containerLogs",
                unit,
              })
                .then((r) => setOutput(r.stdout + r.stderr))
                .catch(reportError)
            }
          >
            读取所填容器的最近日志
          </Button>
        )}
        {kind === "files" ? (
          <>
            <Space className="toolbar">
              <Input
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                style={{ width: 460 }}
                onPressEnter={() => listFiles()}
              />
              <Button onClick={() => listFiles()}>打开目录</Button>
              <Button
                onClick={async () => {
                  const localPath = await call<string | null>("dialog.open", {
                    mode: "file",
                  });
                  if (localPath) {
                    const path =
                      filePath.replace(/\/$/, "") +
                      "/" +
                      localPath.split(/[\\/]/).pop();
                    Modal.confirm({
                      title: "上传文件",
                      content: `将写入 ${path}，同名文件会被覆盖。`,
                      onOk: () =>
                        call("file.upload", {
                          hostId: selected!.id,
                          path,
                          localPath,
                        }).then(() => listFiles()),
                    });
                  }
                }}
              >
                上传
              </Button>
              <Button
                onClick={() => {
                  let name = "";
                  Modal.confirm({
                    title: "新建目录",
                    content: (
                      <Input
                        onChange={(e) => (name = e.target.value)}
                        placeholder="目录名称"
                      />
                    ),
                    onOk: () =>
                      call("file.mkdir", {
                        hostId: selected!.id,
                        path: filePath.replace(/\/$/, "") + "/" + name,
                      }).then(() => listFiles()),
                  });
                }}
              >
                新建目录
              </Button>
            </Space>
            <Table
              rowKey="path"
              dataSource={files}
              columns={[
                {
                  title: "名称",
                  dataIndex: "name",
                  render: (v, f) => (
                    <Button
                      type="link"
                      onClick={() =>
                        f.directory
                          ? listFiles(f.path)
                          : call<string>("file.read", {
                              hostId: selected!.id,
                              path: f.path,
                            })
                              .then((content) =>
                                setEditingFile({ path: f.path, content }),
                              )
                              .catch(reportError)
                      }
                    >
                      {f.directory ? "📁 " : ""}
                      {v}
                    </Button>
                  ),
                },
                { title: "大小", dataIndex: "size" },
                {
                  title: "操作",
                  render: (_, f) => (
                    <Space>
                      <Button
                        size="small"
                        disabled={f.directory}
                        onClick={async () => {
                          const localPath = await call("dialog.open", {
                            mode: "save",
                          });
                          if (localPath)
                            await call("file.download", {
                              hostId: selected!.id,
                              path: f.path,
                              localPath,
                            }).catch(reportError);
                        }}
                      >
                        下载
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          let destination = f.path;
                          Modal.confirm({
                            title: "重命名 / 移动",
                            content: (
                              <Input
                                defaultValue={f.path}
                                onChange={(e) => (destination = e.target.value)}
                              />
                            ),
                            onOk: () =>
                              call("file.rename", {
                                hostId: selected!.id,
                                path: f.path,
                                destination,
                              }).then(() => listFiles()),
                          });
                        }}
                      >
                        重命名
                      </Button>
                      <Popconfirm
                        title={`删除 ${f.path}？仅支持文件和空目录。`}
                        onConfirm={() =>
                          call("file.remove", {
                            hostId: selected!.id,
                            path: f.path,
                          })
                            .then(() => listFiles())
                            .catch(reportError)
                        }
                      >
                        <Button danger size="small">
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <>
            <Space className="toolbar">
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => inspect(selected!)}
              >
                刷新
              </Button>
              {["services", "journal", "containers"].includes(kind) && (
                <Input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder={
                    kind === "containers"
                      ? "容器 ID / 名称"
                      : "服务名，例如 nginx.service"
                  }
                  style={{ width: 300 }}
                />
              )}
              {["services", "containers"].includes(kind) &&
                ["start", "stop", "restart"].map((a, i) => (
                  <Button
                    key={a}
                    disabled={!unit}
                    onClick={() => performAction(a)}
                  >
                    {["启动", "停止", "重启"][i]}
                  </Button>
                ))}
            </Space>
            <pre className="output">
              {loading ? "正在读取主机信息…" : output || "暂无数据"}
            </pre>
          </>
        )}
      </Drawer>
      <Modal
        title="确认服务操作"
        width={800}
        open={!!actionPreview}
        onCancel={() => setActionPreview(undefined)}
        okText="确认执行"
        onOk={async () => {
          const p = actionPreview!;
          const { token, digest, username, hostName, ...spec } = p;
          await call("execution.run", { token, spec });
          setActionPreview(undefined);
          refresh();
        }}
      >
        <Alert
          type="warning"
          title={`${actionPreview?.hostName ?? ""} · ${actionPreview?.username ?? ""} · sudo: ${actionPreview?.sudo ? "是" : "否"}`}
        />
        <ScriptEditor value={actionPreview?.script ?? ""} readOnly />
      </Modal>
      <Modal
        title={editingFile?.path}
        width={900}
        open={!!editingFile}
        onCancel={() => setEditingFile(undefined)}
        okText="保存覆盖"
        onOk={() => {
          Modal.confirm({
            title: `确认覆盖 ${editingFile!.path}？`,
            onOk: () =>
              call("file.write", {
                hostId: selected!.id,
                path: editingFile!.path,
                content: editingFile!.content,
              }).then(() => setEditingFile(undefined)),
          });
        }}
      >
        <Input.TextArea
          rows={20}
          value={editingFile?.content}
          onChange={(e) =>
            setEditingFile((f) => (f ? { ...f, content: e.target.value } : f))
          }
          className="mono"
        />
      </Modal>
    </>
  );
}
