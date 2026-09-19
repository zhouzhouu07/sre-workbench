import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
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
  message,
} from "antd";
import type {
  Snapshot,
  DeploymentSpec,
  DeploymentPreflightReport,
  Task,
} from "../../shared/types";
import { call, reportError } from "../api";
import ScriptEditor from "../components/ScriptEditor";
import TaskFeedback from "../components/TaskFeedback";
const defaults = {
  sourceType: "local",
  gitRef: "main",
  template: "node",
  runtime: "22.14.0",
  installCommand: "npm ci",
  buildCommand: "",
  startCommand: "npm start",
  outputDir: "dist",
  containerPort: 3000,
  publicPort: 8080,
  domain: "",
  healthPath: "/",
  envText: "{}",
  volumesText: "[]",
};
function checkLabel(id: string) {
  const labels: Record<string, string> = {
    privilege: "执行权限",
    platform: "系统与架构",
    systemd: "任务服务",
    tools: "基础工具",
    curl: "HTTP 检查工具",
    memory: "可用内存",
    "runtime-conflicts": "容器运行时冲突",
    docker: "Docker 服务",
    compose: "Compose 插件",
    dns: "域名解析",
    selinux: "SELinux 策略",
    firewall: "防火墙策略",
    connection: "连接与检查结果",
  };
  if (id.startsWith("disk-")) return "磁盘空间 " + id.slice(5);
  if (id.startsWith("port-")) return "端口 " + id.slice(5);
  if (id.startsWith("volume-")) return "挂载目录 " + (Number(id.slice(7)) + 1);
  return labels[id] ?? id;
}
export default function Deployments({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeploymentSpec>();
  const [form] = Form.useForm();
  const [preview, setPreview] = useState<{
    id: string;
    releaseId?: string;
    token: string;
    summary: string;
    script: string;
    preflight: DeploymentPreflightReport;
  }>();
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<Task[]>([]);
  const sourceType = Form.useWatch("sourceType", form);
  const template = Form.useWatch("template", form);
  const edit = (d?: DeploymentSpec) => {
    setEditing(d);
    form.resetFields();
    form.setFieldsValue(
      d
        ? {
            ...d,
            envText: JSON.stringify(d.env, null, 2),
            volumesText: JSON.stringify(d.volumes, null, 2),
          }
        : defaults,
    );
    setOpen(true);
  };
  const prepare = async (id: string, releaseId?: string) => {
    setBusy(true);
    try {
      const preflight = await call<DeploymentPreflightReport>(
        "deployment.preflight",
        { id, ...(releaseId ? { releaseId } : {}) },
      );
      setPreview({
        preflight,
        id,
        releaseId,
        ...(await call<{ token: string; summary: string; script: string }>(
          releaseId ? "deployment.rollback.preview" : "deployment.preview",
          { id, ...(releaseId ? { releaseId } : {}) },
        )),
      });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    try {
      await form.validateFields();
      const { envText, volumesText, ...v } = form.getFieldsValue(true);
      await call("deployment.save", {
        ...v,
        id: editing?.id,
        env: JSON.parse(envText || "{}"),
        volumes: JSON.parse(volumesText || "[]"),
      });
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
          <Typography.Title level={2}>应用部署</Typography.Title>
          <p>从源码到服务，保存方案后重复一键发布</p>
        </div>
        <Button type="primary" onClick={() => edit()}>
          新建部署方案
        </Button>
      </div>
      <div className="deploy-flow">
        <span>01 环境预检</span>
        <b>→</b>
        <span>02 源码传输</span>
        <b>→</b>
        <span>03 构建镜像</span>
        <b>→</b>
        <span>04 健康检查</span>
        <b>→</b>
        <span>05 切换入口</span>
      </div>
      <Table
        rowKey="id"
        dataSource={data.deployments}
        columns={[
          { title: "应用", dataIndex: "name" },
          {
            title: "主机",
            dataIndex: "hostId",
            render: (id) => data.hosts.find((h) => h.id === id)?.name ?? id,
          },
          {
            title: "模板",
            dataIndex: "template",
            render: (v) => <Tag color="blue">{v}</Tag>,
          },
          {
            title: "入口",
            render: (_, d) =>
              d.domain ? `https://${d.domain}` : `HTTP :${d.publicPort}`,
          },
          {
            title: "操作",
            render: (_, d) => (
              <Space>
                <Button
                  type="primary"
                  loading={busy}
                  onClick={() => prepare(d.id)}
                >
                  部署
                </Button>
                <Button onClick={() => edit(d)}>编辑</Button>
                <Button
                  onClick={() =>
                    call("deployment.refresh", { id: d.id })
                      .then(refresh)
                      .catch(reportError)
                  }
                >
                  同步版本
                </Button>
                <Popconfirm
                  title="删除此部署方案？"
                  description="删除本地方案及版本记录。远端应用继续运行，不会卸载。"
                  onConfirm={() =>
                    call("deployment.delete", { id: d.id })
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
        expandable={{
          expandedRowRender: (d) => (
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={data.releases.filter((r) => r.deploymentId === d.id)}
              columns={[
                { title: "版本", dataIndex: "image" },
                { title: "状态", dataIndex: "status" },
                { title: "时间", dataIndex: "createdAt" },
                {
                  title: "操作",
                  render: (_, r) => (
                    <Button
                      disabled={
                        !["succeeded", "active", "success"].includes(r.status)
                      }
                      onClick={() => prepare(d.id, r.id)}
                    >
                      回退到此版本
                    </Button>
                  ),
                },
              ]}
            />
          ),
        }}
      />
      <Card style={{ marginTop: 24 }}>
        <Alert
          type="info"
          title="应用回退只切换镜像版本，数据库与持久化目录不会回退。"
          description="已有 Web 服务占用端口时，预检会阻止部署。源码构建在 Linux 主机运行，请仅部署可信项目。"
        />
      </Card>
      <Modal
        title={editing ? "编辑部署方案" : "新建部署方案"}
        width={850}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText="保存方案"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="two-col">
            <Form.Item
              name="name"
              label="应用名称（小写英文/数字/横线）"
              rules={[{ required: true, pattern: /^[a-z][a-z0-9-]{0,39}$/ }]}
            >
              <Input placeholder="my-web" />
            </Form.Item>
            <Form.Item
              name="hostId"
              label="目标主机"
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
          <Form.Item name="sourceType" label="源码来源">
            <Select
              options={[
                { value: "local", label: "本地项目目录" },
                { value: "git", label: "HTTPS Git 仓库" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label={sourceType === "git" ? "仓库 URL" : "项目目录"}
            required
          >
            <Space.Compact style={{ width: "100%" }}>
              <Form.Item name="source" noStyle rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              {sourceType !== "git" && (
                <Button
                  onClick={async () => {
                    const path = await call("dialog.open", {
                      mode: "directory",
                    });
                    if (path) form.setFieldValue("source", path);
                  }}
                >
                  选择目录
                </Button>
              )}
            </Space.Compact>
          </Form.Item>
          {sourceType === "git" && (
            <div className="two-col">
              <Form.Item name="gitRef" label="分支或提交">
                <Input />
              </Form.Item>
              <Form.Item name="gitToken" label="Git 访问令牌">
                <Input.Password placeholder="私有仓库需要；留空保留原值" />
              </Form.Item>
            </div>
          )}
          <div className="two-col">
            <Form.Item name="template" label="应用模板">
              <Select
                onChange={(v) => {
                  form.setFieldsValue(
                    v === "python"
                      ? {
                          runtime: "3.12.9",
                          installCommand:
                            "pip install --no-cache-dir -r requirements.txt",
                          startCommand: "python app.py",
                          containerPort: 8000,
                        }
                      : v === "static"
                        ? {
                            runtime: "22.14.0",
                            installCommand: "npm ci",
                            buildCommand: "npm run build",
                            containerPort: 80,
                          }
                        : {
                            runtime: "22.14.0",
                            installCommand: "npm ci",
                            startCommand: "npm start",
                            containerPort: 3000,
                          },
                  );
                }}
                options={[
                  { value: "node", label: "Node.js 服务" },
                  { value: "static", label: "前端静态站点" },
                  { value: "python", label: "Python Web 服务" },
                  { value: "dockerfile", label: "项目自带 Dockerfile" },
                ]}
              />
            </Form.Item>
            <Form.Item name="runtime" label="运行时版本">
              <Input disabled={template === "dockerfile"} />
            </Form.Item>
          </div>
          {sourceType === "local" && (
            <Button
              onClick={() =>
                call("deployment.detect", {
                  path: form.getFieldValue("source"),
                  template: form.getFieldValue("template"),
                })
                  .then((v) => {
                    form.setFieldsValue(v);
                    void message.success("已读取项目配置，请核对命令");
                  })
                  .catch(reportError)
              }
              style={{ marginBottom: 16 }}
            >
              从项目识别配置
            </Button>
          )}
          {template !== "dockerfile" && (
            <>
              <Form.Item name="installCommand" label="安装依赖命令">
                <Input />
              </Form.Item>
              <Form.Item name="buildCommand" label="构建命令（可空）">
                <Input />
              </Form.Item>
              {template === "static" ? (
                <Form.Item name="outputDir" label="构建产物目录">
                  <Input />
                </Form.Item>
              ) : (
                <Form.Item name="startCommand" label="启动命令">
                  <Input />
                </Form.Item>
              )}
            </>
          )}
          <div className="two-col">
            <Form.Item name="containerPort" label="容器端口">
              <InputNumber min={1} max={65535} />
            </Form.Item>
            <Form.Item name="publicPort" label="HTTP 入口端口">
              <InputNumber min={1} max={65535} />
            </Form.Item>
          </div>
          <div className="two-col">
            <Form.Item name="domain" label="域名（选填，自动 HTTPS）">
              <Input placeholder="app.example.com" />
            </Form.Item>
            <Form.Item name="healthPath" label="健康检查路径">
              <Input placeholder="/health" />
            </Form.Item>
          </div>
          <Collapse
            items={[
              {
                key: "advanced",
                label: "环境变量与持久化目录",
                children: (
                  <>
                    <Form.Item name="envText" label="环境变量 JSON">
                      <Input.TextArea rows={4} className="mono" />
                    </Form.Item>
                    <Form.Item
                      name="volumesText"
                      label='目录映射 JSON，例如 [{"source":"/srv/data","target":"/data"}]'
                    >
                      <Input.TextArea rows={3} className="mono" />
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
      <Modal
        title={preview?.releaseId ? "确认版本回退" : "确认部署变更"}
        width={950}
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        confirmLoading={busy}
        okText="确认执行"
        okButtonProps={{ disabled: !preview?.preflight.ready }}
        onOk={async () => {
          setBusy(true);
          try {
            const task = await call<Task>(
              preview?.releaseId ? "deployment.rollback.run" : "deployment.run",
              {
                id: preview!.id,
                token: preview!.token,
                ...(preview?.releaseId ? { releaseId: preview.releaseId } : {}),
              },
            );
            setSubmitted([task]);
            setPreview(undefined);
            refresh();
            void message.success("部署任务已创建，请在任务中心查看");
          } catch (e) {
            reportError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Alert type="warning" title={preview?.summary} />
        <Alert
          style={{ marginTop: 12 }}
          type={preview?.preflight.ready ? "success" : "error"}
          title={
            preview?.preflight.ready
              ? "环境预检通过，可以确认执行"
              : "环境预检未通过，请处理失败项后重新检查"
          }
          description="检查不会安装软件或修改主机。执行前会再次检查；预检通过不保证构建依赖、镜像仓库和公网访问可达。"
        />
        <Button
          style={{ marginTop: 12 }}
          loading={busy}
          onClick={() => preview && prepare(preview.id, preview.releaseId)}
        >
          重新检查环境
        </Button>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={preview?.preflight.checks ?? []}
          columns={[
            { title: "检查项", dataIndex: "id", render: checkLabel },
            {
              title: "结果",
              dataIndex: "status",
              render: (status: string) => (
                <Tag
                  color={
                    status === "pass"
                      ? "success"
                      : status === "warn"
                        ? "warning"
                        : "error"
                  }
                >
                  {status === "pass"
                    ? "通过"
                    : status === "warn"
                      ? "提示"
                      : "失败"}
                </Tag>
              ),
            },
            { title: "检查详情", dataIndex: "detail" },
          ]}
        />
        <ScriptEditor value={preview?.script ?? ""} readOnly height="450px" />
      </Modal>
      <TaskFeedback tasks={submitted} />
    </>
  );
}
