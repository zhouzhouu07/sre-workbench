import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { Snapshot, AIProvider } from "../../shared/types";
import { call, reportError } from "../api";
export default function Settings({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AIProvider>();
  const [testing, setTesting] = useState<string>();
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  }>();
  const [form] = Form.useForm();
  const kind = Form.useWatch("kind", form);
  const edit = (p?: AIProvider) => {
    setEditing(p);
    form.resetFields();
    form.setFieldsValue(
      p
        ? { ...p, protocol: p.protocol ?? "auto" }
        : {
            kind: "model",
            protocol: "auto",
            timeout: 120,
            baseUrl: "https://api.openai.com/v1",
            model: "",
          },
    );
    setOpen(true);
  };
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>设置</Typography.Title>
          <p>管理模型 API 与外部 Agent 连接</p>
        </div>
        <Button type="primary" onClick={() => edit()}>
          添加 API
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={data.providers}
        columns={[
          { title: "名称", dataIndex: "name" },
          {
            title: "类型",
            dataIndex: "kind",
            render: (v) => (
              <Tag>{v === "model" ? "兼容模型 API" : "HTTP Agent"}</Tag>
            ),
          },
          { title: "地址", dataIndex: "baseUrl" },
          { title: "模型", dataIndex: "model" },
          {
            title: "协议",
            render: (_, p) =>
              p.kind === "agent"
                ? "HTTP Agent"
                : {
                    auto: "自动识别",
                    openai: "OpenAI",
                    anthropic: "Anthropic",
                  }[p.protocol ?? "auto"],
          },
          {
            title: "操作",
            render: (_, p) => (
              <Space>
                <Button onClick={() => edit(p)}>编辑</Button>
                <Button
                  loading={testing === p.id}
                  disabled={!!testing}
                  onClick={async () => {
                    setTesting(p.id);
                    setTestResult(undefined);
                    try {
                      const result = await call<{
                        protocol: string;
                        endpoint: string;
                        elapsedMs: number;
                      }>("provider.test", { id: p.id });
                      setTestResult({
                        ok: true,
                        message: `${p.name} 连接成功：${result.protocol} · ${result.endpoint} · ${result.elapsedMs} ms`,
                      });
                    } catch (e) {
                      setTestResult({
                        ok: false,
                        message:
                          e instanceof Error ? e.message : "连接测试失败",
                      });
                    } finally {
                      setTesting(undefined);
                    }
                  }}
                >
                  测试连接
                </Button>
                <Popconfirm
                  title="删除此 API 配置？"
                  onConfirm={() =>
                    call("provider.delete", { id: p.id })
                      .then(refresh)
                      .catch(reportError)
                  }
                >
                  <Button danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {testResult && (
        <Alert
          style={{ marginTop: 16 }}
          type={testResult.ok ? "success" : "error"}
          title={testResult.message}
          showIcon
        />
      )}
      <p className="muted">
        测试连接使用已保存配置，仅发送固定测试短句，不包含主机或日志数据；可能产生少量
        API 费用。
      </p>
      <Card title="本地数据与凭据" style={{ marginTop: 24 }}>
        <p>
          配置和任务历史保存在当前 Windows 用户的应用数据目录。凭据经 Windows
          系统加密后写入本地 SQLite。
        </p>
        <p className="muted">
          模型接口支持 OpenAI Chat Completions 与 Anthropic Messages
          协议；DeepSeek 的 /anthropic 地址会自动识别。 外部 Agent
          使用本软件定义的 HTTP JSON 协议。可设置本机回环地址连接本地服务。
        </p>
        <Alert
          type="info"
          title="主机连接密钥变化时，需要先核实，再删除并重新添加该主机。"
        />
      </Card>
      <Modal
        title={editing ? "编辑 API" : "添加 API"}
        open={open}
        onCancel={() => setOpen(false)}
        okText="保存"
        onOk={async () => {
          try {
            const v = await form.validateFields();
            await call("provider.save", { ...v, id: editing?.id });
            setOpen(false);
            refresh();
          } catch (e) {
            if (e instanceof Error) reportError(e);
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="类型" name="kind">
            <Select
              options={[
                { value: "model", label: "兼容模型 API" },
                { value: "agent", label: "外部 HTTP Agent" },
              ]}
            />
          </Form.Item>
          {kind === "model" && (
            <Form.Item
              label="接口协议"
              name="protocol"
              extra="自动识别 Anthropic 官方域名、/anthropic 路径或 /messages 端点，其他地址按 OpenAI 处理。自定义网关可手动指定。"
            >
              <Select
                options={[
                  { value: "auto", label: "自动识别" },
                  { value: "openai", label: "OpenAI Chat Completions" },
                  { value: "anthropic", label: "Anthropic Messages" },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item
            label={
              kind === "agent"
                ? "完整 Agent 接口 URL"
                : "API 基础地址或完整接口 URL"
            }
            name="baseUrl"
            rules={[{ required: true }]}
            extra={
              kind === "model"
                ? "例如 https://api.deepseek.com/anthropic 或 https://api.openai.com/v1；完整 /messages、/chat/completions 地址不会重复追加。"
                : undefined
            }
          >
            <Input />
          </Form.Item>
          {kind === "model" && (
            <Form.Item
              label="模型名称"
              name="model"
              rules={[{ required: true }]}
            >
              <Input placeholder="填写你的服务支持的模型 ID" />
            </Form.Item>
          )}
          <Form.Item label="API Key / Bearer Token" name="apiKey">
            <Input.Password placeholder={editing ? "留空保留原密钥" : ""} />
          </Form.Item>
          <Form.Item label="超时（秒）" name="timeout">
            <InputNumber min={10} max={600} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
