import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { MonitoringStack, Snapshot, Task } from "../../shared/types";
import { call, reportError } from "../api";
import ScriptEditor from "../components/ScriptEditor";
import TaskFeedback from "../components/TaskFeedback";
import {
  durationPattern,
  smtpProviders,
  validEmail,
  validRecipients,
  validSmtpHost,
  validTargetAddress,
} from "../../shared/monitoring-form";
export default function Monitoring({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MonitoringStack>();
  const [form] = Form.useForm();
  const [preview, setPreview] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [saveError, setSaveError] = useState<string>();
  const [provider, setProvider] = useState("qq");
  const [submitted, setSubmitted] = useState<Task[]>([]);
  const [smtpAdvanced, setSmtpAdvanced] = useState<string[]>([]);
  const [alertAdvanced, setAlertAdvanced] = useState<string[]>([]);
  const emailEnabled = Form.useWatch("smtpEnabled", form);
  const [status, setStatus] = useState<unknown>();
  const edit = (m?: MonitoringStack) => {
    setEditing(m);
    setSmtpAdvanced([]);
    setAlertAdvanced([]);
    setSaveError(undefined);
    setProvider(m ? "custom" : "qq");
    form.resetFields();
    form.setFieldsValue(
      m
        ? { ...m, smtpEnabled: m.smtpEnabled ?? !!m.smtpHost }
        : {
            name: "基础设施监控",
            retentionDays: 15,
            cpuThreshold: 85,
            memoryThreshold: 90,
            diskThreshold: 90,
            duration: "5m",
            groupWait: "30s",
            groupInterval: "5m",
            repeatInterval: "4h",
            smtpEnabled: false,
            smtpHost: "smtp.qq.com:587",
            smtpFrom: "",
            smtpTo: "",
            smtpUser: "",
            webhook: "",
            targets: [],
          },
    );
    setOpen(true);
  };
  const save = async () => {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      const v = await form.validateFields();
      const values = { ...form.getFieldsValue(true), ...v };
      delete values.webhookCredentialId;
      await call("monitoring.save", {
        ...values,
        smtpUser:
          provider === "custom" ? (values.smtpUser ?? "") : values.smtpFrom,
        id: editing?.id,
      });
      setOpen(false);
      refresh();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) {
        const fields = (e as { errorFields: { name: (string | number)[] }[] })
          .errorFields;
        if (
          fields.some((f) =>
            ["smtpHost", "smtpUser"].includes(String(f.name[0])),
          )
        )
          setSmtpAdvanced(["smtp"]);
        if (
          fields.some((f) =>
            [
              "groupWait",
              "groupInterval",
              "repeatInterval",
              "webhook",
            ].includes(String(f.name[0])),
          )
        )
          setAlertAdvanced(["alerts"]);
        if (fields[0]) form.scrollToField(fields[0].name);
      } else {
        setSaveError(e instanceof Error ? e.message : "保存失败，请重试");
      }
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>监控告警</Typography.Title>
          <p>Linux 上持续运行，关闭桌面软件后仍可采集和通知</p>
        </div>
        <Button type="primary" onClick={() => edit()}>
          新建监控方案
        </Button>
      </div>
      <div className="monitor-products">
        {[
          ["Prometheus", "时序指标与规则评估"],
          ["Grafana", "主机可视化看板"],
          ["Alertmanager", "告警分组、通知与静默"],
          ["Node Exporter", "Linux 主机指标"],
        ].map(([name, desc]) => (
          <Card key={name}>
            <Tag color="cyan">{name}</Tag>
            <p>{desc}</p>
          </Card>
        ))}
      </div>
      <Table
        rowKey="id"
        dataSource={data.monitoring}
        columns={[
          { title: "方案", dataIndex: "name" },
          {
            title: "监控服务器",
            dataIndex: "hostId",
            render: (id) => data.hosts.find((h) => h.id === id)?.name ?? id,
          },
          { title: "采集主机", dataIndex: "targets", render: (v) => v.length },
          {
            title: "操作",
            render: (_, m) => (
              <Space wrap>
                <Button
                  type="primary"
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setPreview({
                        id: m.id,
                        ...(await call("monitoring.preview", { id: m.id })),
                      });
                    } catch (e) {
                      reportError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  部署 / 更新
                </Button>
                <Button onClick={() => edit(m)}>配置</Button>
                <Button
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: `删除监控方案“${m.name}”？`,
                      content:
                        "仅移除本地配置，不会停止或卸载远程监控服务；远程采集和通知仍会继续运行。",
                      okText: "删除本地配置",
                      cancelText: "取消",
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        try {
                          await call("monitoring.delete", { id: m.id });
                          refresh();
                        } catch (e) {
                          reportError(e);
                          throw e;
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
                <Button
                  onClick={() =>
                    call("monitoring.open", {
                      id: m.id,
                      service: "grafana",
                    }).catch(reportError)
                  }
                >
                  打开 Grafana
                </Button>
                <Button
                  onClick={() =>
                    call("monitoring.status", { id: m.id })
                      .then(setStatus)
                      .catch(reportError)
                  }
                >
                  目标与告警
                </Button>
                <Button
                  onClick={() =>
                    Modal.confirm({
                      title: "发送测试告警？",
                      content:
                        "将向配置的邮件 / Webhook 渠道发送 SREWorkbenchTest 告警。",
                      onOk: () =>
                        call("monitoring.test", { id: m.id }).then(() => {
                          void message.success(
                            "测试告警已提交，请检查接收渠道",
                          );
                        }),
                    })
                  }
                >
                  测试通知
                </Button>
                <Button
                  onClick={() => {
                    let alertname = "",
                      comment = "",
                      minutes = 60;
                    Modal.confirm({
                      title: "创建告警静默",
                      content: (
                        <Space direction="vertical" style={{ width: "100%" }}>
                          <Input
                            placeholder="精确告警名称"
                            onChange={(e) => (alertname = e.target.value)}
                          />
                          <Input
                            placeholder="静默原因"
                            onChange={(e) => (comment = e.target.value)}
                          />
                          <InputNumber
                            defaultValue={60}
                            min={1}
                            max={10080}
                            addonAfter="分钟"
                            onChange={(v) => (minutes = v ?? 60)}
                          />
                        </Space>
                      ),
                      onOk: () =>
                        call("monitoring.silence", {
                          id: m.id,
                          alertname,
                          minutes,
                          comment,
                        }).then(() => {
                          void message.success("静默已创建");
                        }),
                    });
                  }}
                >
                  静默
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Alert
        style={{ marginTop: 24 }}
        type="info"
        showIcon
        title="管理界面通过 SSH 隧道打开，指标从内网或 VPN 采集。"
        description="软件不会修改防火墙。请确保监控服务器能访问各主机所填内网地址的 9100 端口。"
      />
      <Modal
        title={editing ? "编辑监控方案" : "新建监控方案"}
        open={open}
        width={850}
        onCancel={() => setOpen(false)}
        onOk={save}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        maskClosable={!saving}
        okText="保存方案"
      >
        <Form form={form} layout="vertical">
          {saveError && (
            <Alert
              type="error"
              showIcon
              title={saveError}
              style={{ marginBottom: 16 }}
            />
          )}
          <div className="two-col">
            <Form.Item
              name="name"
              label="方案名称"
              rules={[
                { required: true, whitespace: true, message: "请输入方案名称" },
                { max: 100, message: "方案名称最多 100 字" },
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="hostId"
              label="监控服务器"
              rules={[{ required: true, message: "请选择监控服务器" }]}
            >
              <Select
                disabled={!!editing}
                options={data.hosts.map((h) => ({
                  value: h.id,
                  label: h.name,
                }))}
              />
            </Form.Item>
          </div>
          <Form.List
            name="targets"
            rules={[
              {
                validator: async (_, targets) => {
                  if (!targets?.length)
                    throw new Error("请至少添加一台采集主机");
                  if (targets.length > 20)
                    throw new Error("最多添加 20 台采集主机");
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                <Typography.Title level={5}>采集目标</Typography.Title>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline">
                    <Form.Item
                      name={[f.name, "hostId"]}
                      rules={[
                        { required: true, message: "请选择采集主机" },
                        {
                          validator: async (_, value) => {
                            if (
                              value &&
                              form
                                .getFieldValue("targets")
                                .filter(
                                  (t: { hostId?: string }) =>
                                    t?.hostId === value,
                                ).length > 1
                            )
                              throw new Error("同一主机不能重复添加");
                          },
                        },
                      ]}
                    >
                      <Select
                        placeholder="SSH 主机"
                        style={{ width: 260 }}
                        options={data.hosts.map((h) => ({
                          value: h.id,
                          label: h.name,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[f.name, "address"]}
                      rules={[
                        { required: true, message: "请输入采集地址" },
                        {
                          validator: async (_, value) => {
                            if (value && !validTargetAddress(value))
                              throw new Error("请输入主机间可达的 IPv4 地址");
                          },
                        },
                      ]}
                    >
                      <Input
                        placeholder="绑定及采集的内网 IP"
                        style={{ width: 300 }}
                      />
                    </Form.Item>
                    <Button danger onClick={() => remove(f.name)}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button disabled={fields.length >= 20} onClick={() => add()}>
                  添加采集主机
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
          <div className="two-col" style={{ marginTop: 20 }}>
            <Form.Item
              name="retentionDays"
              label="指标保留天数"
              rules={[
                {
                  type: "integer",
                  required: true,
                  min: 1,
                  max: 365,
                  message: "请输入 1–365 的整数",
                },
              ]}
            >
              <InputNumber min={1} max={365} />
            </Form.Item>
            <Form.Item
              name="grafanaPassword"
              label="Grafana 管理员密码"
              rules={[
                { required: !editing, message: "请输入 Grafana 管理员密码" },
                { min: 12, message: "密码至少 12 位" },
              ]}
            >
              <Input.Password
                placeholder={editing ? "留空保留原密码" : "至少 12 位"}
              />
            </Form.Item>
          </div>
          <div className="three-col">
            <Form.Item
              name="cpuThreshold"
              label="CPU 告警阈值 %"
              rules={[
                {
                  type: "number",
                  required: true,
                  min: 1,
                  max: 100,
                  message: "请输入 1–100 的阈值",
                },
              ]}
            >
              <InputNumber min={1} max={100} />
            </Form.Item>
            <Form.Item
              name="memoryThreshold"
              label="内存告警阈值 %"
              rules={[
                {
                  type: "number",
                  required: true,
                  min: 1,
                  max: 100,
                  message: "请输入 1–100 的阈值",
                },
              ]}
            >
              <InputNumber min={1} max={100} />
            </Form.Item>
            <Form.Item
              name="diskThreshold"
              label="磁盘告警阈值 %"
              rules={[
                {
                  type: "number",
                  required: true,
                  min: 1,
                  max: 100,
                  message: "请输入 1–100 的阈值",
                },
              ]}
            >
              <InputNumber min={1} max={100} />
            </Form.Item>
          </div>
          <div className="two-col">
            <Form.Item
              name="duration"
              label="持续时间"
              rules={[
                {
                  required: true,
                  pattern: durationPattern,
                  message: "请输入持续时间，例如 5m、30s、1h",
                },
              ]}
            >
              <Input />
            </Form.Item>
          </div>
          <Typography.Title level={5}>邮件通知</Typography.Title>
          <Form.Item
            name="smtpEnabled"
            label="启用邮件通知"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          {emailEnabled && (
            <>
              <Form.Item label="邮箱服务商">
                <Select
                  value={provider}
                  options={smtpProviders}
                  onChange={(value) => {
                    setProvider(value);
                    const selected = smtpProviders.find(
                      (p) => p.value === value,
                    );
                    if (selected?.host)
                      form.setFieldValue("smtpHost", selected.host);
                  }}
                />
              </Form.Item>
              <div className="two-col">
                <Form.Item
                  name="smtpFrom"
                  label="发件邮箱"
                  rules={[
                    { required: true, message: "请输入发件邮箱" },
                    {
                      validator: async (_, value) => {
                        if (value && !validEmail(value))
                          throw new Error("请输入有效的发件邮箱");
                      },
                    },
                  ]}
                >
                  <Input placeholder="sender@qq.com" />
                </Form.Item>
                <Form.Item
                  name="smtpTo"
                  label="收件邮箱"
                  rules={[
                    { required: true, message: "请输入收件邮箱" },
                    {
                      validator: async (_, value) => {
                        if (value && !validRecipients(value))
                          throw new Error(
                            "请输入有效邮箱，多个邮箱用英文逗号分隔",
                          );
                      },
                    },
                  ]}
                >
                  <Input placeholder="ops@example.com，多个邮箱用英文逗号分隔" />
                </Form.Item>
                <Form.Item
                  name="smtpPassword"
                  label="邮箱授权码 / SMTP 密码"
                  extra="在邮箱设置中开启 SMTP 并获取授权码。已有授权码留空保留。"
                  rules={[
                    {
                      required:
                        provider !== "custom" && !editing?.smtpCredentialId,
                      message: "请输入邮箱授权码或 SMTP 密码",
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={
                      editing?.smtpCredentialId
                        ? "留空保留原授权码"
                        : "请输入邮箱授权码"
                    }
                  />
                </Form.Item>
              </div>
              {provider === "custom" && (
                <Collapse
                  activeKey={smtpAdvanced}
                  onChange={(keys) =>
                    setSmtpAdvanced(typeof keys === "string" ? [keys] : keys)
                  }
                  items={[
                    {
                      key: "smtp",
                      label: "高级 SMTP 设置",
                      forceRender: true,
                      children: (
                        <div className="two-col">
                          <Form.Item
                            name="smtpHost"
                            label="SMTP 主机:端口"
                            rules={[
                              {
                                required: true,
                                message: "请输入 SMTP 主机:端口",
                              },
                              {
                                validator: async (_, value) => {
                                  if (value && !validSmtpHost(value))
                                    throw new Error(
                                      "请输入 SMTP 主机:端口，端口范围 1–65535",
                                    );
                                },
                              },
                            ]}
                          >
                            <Input placeholder="smtp.example.com:587" />
                          </Form.Item>
                          <Form.Item
                            name="smtpUser"
                            label="SMTP 用户"
                            extra="自定义服务留空表示不使用 SMTP 认证"
                          >
                            <Input placeholder="认证用户名，免认证中继可留空" />
                          </Form.Item>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </>
          )}
          <Collapse
            style={{ marginTop: 16 }}
            activeKey={alertAdvanced}
            onChange={(keys) =>
              setAlertAdvanced(typeof keys === "string" ? [keys] : keys)
            }
            items={[
              {
                key: "alerts",
                label: "高级告警设置：分组与 Webhook",
                forceRender: true,
                children: (
                  <>
                    <div className="two-col">
                      <Form.Item
                        name="groupWait"
                        label="首次分组等待"
                        rules={[
                          {
                            required: true,
                            pattern: durationPattern,
                            message: "请输入时间，例如 30s、5m、4h",
                          },
                        ]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name="groupInterval"
                        label="分组间隔"
                        rules={[
                          {
                            required: true,
                            pattern: durationPattern,
                            message: "请输入时间，例如 30s、5m、4h",
                          },
                        ]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name="repeatInterval"
                        label="重复通知间隔"
                        rules={[
                          {
                            required: true,
                            pattern: durationPattern,
                            message: "请输入时间，例如 30s、5m、4h",
                          },
                        ]}
                      >
                        <Input />
                      </Form.Item>
                    </div>
                    <Form.Item
                      name="webhook"
                      label="Alertmanager 标准 Webhook URL"
                      rules={[
                        {
                          validator: async (_, value) => {
                            if (!value || value === "[REDACTED]") return;
                            try {
                              const url = new URL(value);
                              if (
                                url.protocol === "https:" &&
                                !url.username &&
                                !url.password
                              )
                                return;
                            } catch {
                              /* Show a field error below. */
                            }
                            throw new Error("请输入不含用户名密码的 HTTPS URL");
                          },
                        },
                      ]}
                    >
                      <Input placeholder="https://hooks.example.com/alerts" />
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
      <Modal
        title="确认监控部署"
        width={950}
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        confirmLoading={busy}
        okText="确认部署"
        onOk={async () => {
          setBusy(true);
          try {
            const tasks = await call<Task[]>("monitoring.run", {
              id: preview.id,
              token: preview.token,
            });
            setSubmitted(tasks);
            setPreview(undefined);
            refresh();
            void message.success("已提交监控部署任务");
          } catch (e) {
            reportError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Alert type="warning" title={preview?.summary} />
        <ScriptEditor value={preview?.script ?? ""} height="450px" readOnly />
      </Modal>
      <Modal
        title="采集目标与告警状态"
        width={1000}
        open={status !== undefined}
        onCancel={() => setStatus(undefined)}
        footer={null}
      >
        <pre className="output">{JSON.stringify(status, null, 2)}</pre>
      </Modal>
      <TaskFeedback tasks={submitted} />
    </>
  );
}
