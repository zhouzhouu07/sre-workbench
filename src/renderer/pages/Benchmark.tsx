import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { benchmarkScenarios, type BenchmarkRun } from "../../shared/benchmark";
import type { Snapshot } from "../../shared/types";
import { call, reportError } from "../api";
export default function Benchmark() {
  const [data, setData] = useState<Snapshot>(),
    [runs, setRuns] = useState<(BenchmarkRun & { statistics: any[] })[]>([]),
    [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const load = useCallback(async () => {
    const [d, r] = await Promise.all([
      call<Snapshot>("snapshot"),
      call<(BenchmarkRun & { statistics: any[] })[]>("studio.benchmark.list"),
    ]);
    setData(d);
    setRuns(r);
  }, []);
  useEffect(() => {
    void load().catch(reportError);
    const t = setInterval(() => void load().catch(reportError), 3000);
    return () => clearInterval(t);
  }, [load]);
  const action = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
      await load();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  return (
    <>
      <Card>
        <Typography.Title level={3}>Benchmark · 真实运维实验</Typography.Title>
        <Typography.Paragraph>
          A：通用 Agent；B：SRE 技能与计划；C：Agent Studio
          工作流。三组使用同一模型和平台安全约束，以独立验证结果计分。
        </Typography.Paragraph>
        <Alert
          type="warning"
          showIcon
          title="实验会在所选服务器新建隔离服务、目录和容器，消耗模型额度。已有业务保留；测试资源和证据保留供复核。"
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            modes: ["A", "B", "C"],
            scenarios: [1],
            sudo: false,
            basePort: 18110,
            maxSteps: 40,
            caseTimeoutSeconds: 900,
            allowRestart: false,
            interactionPolicy:"pause",
          }}
          onFinish={(values) =>
            void action(async () => {
              const r = await call<BenchmarkRun>(
                "studio.benchmark.start",
                values,
              );
              setSelected(r.id);
            })
          }
        >
          <Space align="start" wrap>
            <Form.Item
              name="hostId"
              label="测试服务器"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 240 }}
                options={data?.hosts
                  .filter((h) => h.fingerprint)
                  .map((h) => ({
                    value: h.id,
                    label: `${h.name} · ${h.address}`,
                  }))}
              />
            </Form.Item>
            <Form.Item
              name="providerId"
              label="模型 API"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 240 }}
                options={data?.providers
                  .filter((p) => p.kind === "model")
                  .map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
            <Form.Item name="basePort" label="起始端口">
              <InputNumber min={1024} max={64000} />
            </Form.Item>
            <Form.Item name="maxSteps" label="每例步骤上限">
              <InputNumber min={5} max={100} />
            </Form.Item>
            <Form.Item name="caseTimeoutSeconds" label="每例时间上限（秒）">
              <InputNumber min={60} max={3600} />
            </Form.Item>
          </Space>
          <Form.Item name="modes" label="对照模式" rules={[{ required: true }]}>
            <Checkbox.Group
              options={[
                { value: "A", label: "A · 通用 Agent" },
                { value: "B", label: "B · SRE Agent" },
                { value: "C", label: "C · Agent Studio" },
              ]}
            />
          </Form.Item>
          <Form.Item name="interactionPolicy" label="需要审批或补充输入时">
            <Select options={[{value:"pause",label:"暂停实验，等待处理（默认）"},{value:"record_failure",label:"按自主执行未完成计分，继续下一个样本"}]}/>
          </Form.Item>
          <Form.Item
            name="scenarios"
            label="实验场景"
            rules={[{ required: true }]}
          >
            <Select
              mode="multiple"
              options={benchmarkScenarios.map((s) => ({
                value: s.id,
                label: `${s.id}. ${s.name}`,
              }))}
            />
          </Form.Item>
          <Space wrap>
            <Form.Item name="sudo" valuePropName="checked">
              <Checkbox>允许使用已有 sudo</Checkbox>
            </Form.Item>
            <Form.Item name="allowRestart" valuePropName="checked">
              <Checkbox>允许场景 11 实际重启应用（先持久化检查点）</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              开始真实实验
            </Button>
          </Space>
        </Form>
      </Card>
      <Card style={{ marginTop: 16 }}>
        <Space wrap>
          <Select
            aria-label="选择Benchmark实验"
            style={{ width: 420 }}
            value={run?.id}
            onChange={setSelected}
            options={runs.map((r) => ({
              value: r.id,
              label: `${r.createdAt} · ${r.model} · ${r.status}`,
            }))}
          />
          <Button onClick={() => void load().catch(reportError)}>
            刷新实验
          </Button>
          {run && (
            <>
              <Tag>{run.status}</Tag>
              {["pause", "resume", "stop"].map((op, i) => (
                <Button
                  key={op}
                  disabled={
                    busy ||
                    (op === "resume"
                      ? run.status !== "paused"
                      : run.status !== "running" && run.status !== "paused")
                  }
                  onClick={() =>
                    action(() => call(`studio.benchmark.${op}`, { id: run.id }))
                  }
                >
                  {["暂停调度", "继续实验", "停止实验"][i]}
                </Button>
              ))}
              {["json", "csv", "markdown"].map((format) => (
                <Button
                  key={format}
                  onClick={() =>
                    action(() =>
                      call("studio.benchmark.export", { id: run.id, format }),
                    )
                  }
                >
                  导出 {format.toUpperCase()}
                </Button>
              ))}
            </>
          )}
        </Space>
        {run ? (
          <>
            <Alert
              style={{ marginTop: 16, marginBottom: 16 }}
              type={run.status === "paused" ? "warning" : "info"}
              title={run.summary}
            />
            <Typography.Paragraph type="secondary">
              成功率分母为已完成独立评估的样本。准备失败、接口环境阻塞和未执行样本单列；未采集用量显示“—”。需要审批时在
              AI 助手或 Workflows 处理，再继续实验。
            </Typography.Paragraph>
            <Table
              rowKey="mode"
              pagination={false}
              dataSource={run.statistics}
              scroll={{ x: 1050 }}
              columns={[
                { title: "模式", dataIndex: "mode" },
                {
                  title: "已评估/总数",
                  render: (_, s) => `${s.evaluated}/${s.total}`,
                },
                { title: "准备失败", dataIndex: "setupFailures" },
                { title: "接口阻塞", dataIndex: "environmentBlocks" },
                {
                  title: "成功率",
                  render: (_, s) =>
                    s.successRate == null
                      ? "—"
                      : `${Math.round(s.successRate * 100)}%`,
                },
                { title: "工具调用", dataIndex: "toolCalls" },
                { title: "模型调用", render: (_, s) => s.modelCalls ?? "—" },
                { title: "Tokens", render: (_, s) => s.totalTokens ?? "—" },
                { title: "误报成功", dataIndex: "incorrectSuccessClaims" },
              ]}
            />
            <Table
              rowKey="id"
              style={{ marginTop: 16 }}
              dataSource={run.cells}
              pagination={{ pageSize: 12 }}
              expandable={{
                expandedRowRender: (c) => (
                  <>
                    <div>隔离目录：{c.root}</div>
                    <div>
                      执行记录：{c.source} / {c.sourceId ?? "尚未启动"}
                    </div>
                    <div>故障注入：{c.injections.length} 次</div>
                    <pre className="output">
                      {c.error ?? c.evidence?.stdout ?? "等待真实证据"}
                    </pre>
                  </>
                ),
              }}
              columns={[
                {
                  title: "场景",
                  render: (_, c) =>
                    benchmarkScenarios.find((s) => s.id === c.scenario)?.name,
                },
                { title: "模式", dataIndex: "mode" },
                { title: "阶段", dataIndex: "phase" },
                {
                  title: "独立验收",
                  render: (_, c) =>
                    c.success === undefined
                      ? "未评估"
                      : c.success
                        ? "通过"
                        : "未通过",
                },
                { title: "服务端口", dataIndex: "port" },
              ]}
            />
          </>
        ) : (
          <Typography.Paragraph style={{ marginTop: 20 }}>
            暂无实验结果；不会生成演示分数。
          </Typography.Paragraph>
        )}
      </Card>
    </>
  );
}
