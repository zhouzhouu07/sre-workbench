import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { MonitoringStack, Snapshot } from "../../shared/types";
import { call, reportError } from "../api";
import ScriptEditor from "../components/ScriptEditor";
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
  const [status, setStatus] = useState<unknown>();
  const edit = (m?: MonitoringStack) => {
    setEditing(m);
    form.resetFields();
    form.setFieldsValue(
      m ?? {
        name: "基础设施监控",
        retentionDays: 15,
        cpuThreshold: 85,
        memoryThreshold: 90,
        diskThreshold: 90,
        duration: "5m",
        groupWait: "30s",
        groupInterval: "5m",
        repeatInterval: "4h",
        smtpHost: "",
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
    try {
      const v = await form.validateFields();
      await call("monitoring.save", { ...v, id: editing?.id });
      setOpen(false);
      refresh();
    } catch (e) {
      if (e instanceof Error) reportError(e);
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
        okText="保存方案"
      >
        <Form form={form} layout="vertical">
          <div className="two-col">
            <Form.Item
              name="name"
              label="方案名称"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="hostId"
              label="监控服务器"
              rules={[{ required: true }]}
            >
              <Select
                options={data.hosts.map((h) => ({
                  value: h.id,
                  label: h.name,
                }))}
              />
            </Form.Item>
          </div>
          <Form.List name="targets">
            {(fields, { add, remove }) => (
              <>
                <Typography.Title level={5}>采集目标</Typography.Title>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline">
                    <Form.Item
                      name={[f.name, "hostId"]}
                      rules={[{ required: true }]}
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
                      rules={[{ required: true }]}
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
                <Button onClick={() => add()}>添加采集主机</Button>
              </>
            )}
          </Form.List>
          <div className="two-col" style={{ marginTop: 20 }}>
            <Form.Item name="retentionDays" label="指标保留天数">
              <InputNumber min={1} max={365} />
            </Form.Item>
            <Form.Item name="grafanaPassword" label="Grafana 管理员密码">
              <Input.Password
                placeholder={editing ? "留空保留原密码" : "至少 12 位"}
              />
            </Form.Item>
          </div>
          <div className="three-col">
            <Form.Item name="cpuThreshold" label="CPU 告警阈值 %">
              <InputNumber min={1} max={100} />
            </Form.Item>
            <Form.Item name="memoryThreshold" label="内存告警阈值 %">
              <InputNumber min={1} max={100} />
            </Form.Item>
            <Form.Item name="diskThreshold" label="磁盘告警阈值 %">
              <InputNumber min={1} max={100} />
            </Form.Item>
          </div>
          <div className="two-col">
            <Form.Item name="duration" label="持续时间">
              <Input />
            </Form.Item>
            <Form.Item name="groupWait" label="首次分组等待">
              <Input />
            </Form.Item>
            <Form.Item name="groupInterval" label="分组间隔">
              <Input />
            </Form.Item>
            <Form.Item name="repeatInterval" label="重复通知间隔">
              <Input />
            </Form.Item>
          </div>
          <Typography.Title level={5}>邮件通知</Typography.Title>
          <div className="two-col">
            <Form.Item name="smtpHost" label="SMTP 主机:端口">
              <Input placeholder="smtp.example.com:587" />
            </Form.Item>
            <Form.Item name="smtpUser" label="SMTP 用户">
              <Input />
            </Form.Item>
            <Form.Item name="smtpFrom" label="发件地址">
              <Input />
            </Form.Item>
            <Form.Item name="smtpTo" label="收件地址">
              <Input />
            </Form.Item>
            <Form.Item name="smtpPassword" label="SMTP 密码">
              <Input.Password placeholder="留空保留原值" />
            </Form.Item>
          </div>
          <Form.Item name="webhook" label="Alertmanager 标准 Webhook URL">
            <Input placeholder="https://hooks.example.com/alerts" />
          </Form.Item>
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
            await call("monitoring.run", {
              id: preview.id,
              token: preview.token,
            });
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
    </>
  );
}
