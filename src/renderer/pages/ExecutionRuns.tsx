import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ExecutionEvent, ExecutionTrace } from "../../shared/trace";
import { permissionLabels } from "../../shared/agent";
import { call, reportError } from "../api";
import RiskDetails from "../components/RiskDetails";
type Row = {
  id: string;
  source: "agent" | "workflow";
  title: string;
  status: string;
  createdAt: string;
};
const statuses: Record<string, string> = {
  thinking: "正在分析",
  pending: "待执行",
  rejected: "已拒绝",
  approved: "已批准",
  pausing: "正在暂停",
  running: "执行中",
  succeeded: "成功",
  completed: "已完成",
  failed: "失败",
  unknown: "待核实",
  paused: "已暂停",
  cancelled: "已停止",
  awaiting_approval: "等待审批",
  awaiting_input: "等待输入",
  awaiting_agent: "等待子Agent",
};
export default function ExecutionRuns() {
  const [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [trace, setTrace] = useState<ExecutionTrace>(),
    [kind, setKind] = useState("all"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const requestVersion = useRef(0);
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    setTrace(undefined);
    setKind("all");
    setQuery("");
    const load = async () => {
      const version = ++requestVersion.current,
        current = () => !disposed && version === requestVersion.current;
      setLoading(true);
      setError("");
      try {
        const list = await call<Row[]>("studio.trace.list");
        if (!current()) return;
        setRows(list);
        const row = list.find((r) => `${r.source}:${r.id}` === selected),
          next = row
            ? await call<ExecutionTrace>("studio.trace.get", {
                source: row.source,
                id: row.id,
              })
            : undefined;
        if (current()) setTrace(next);
      } catch (e) {
        if (current()) {
          setTrace(undefined);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (current()) setLoading(false);
      }
    };
    void load();
    const off = window.sre?.subscribe((e) => {
      if (e.type === "changed") {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 300);
      }
    });
    return () => {
      disposed = true;
      requestVersion.current++;
      clearTimeout(timer);
      off?.();
    };
  }, [selected, revision]);
  const exportTrace = async (format: "json" | "markdown") => {
    if (!trace || loading) return;
    setBusy(true);
    try {
      await call("studio.trace.export", {
        source: trace.source,
        id: trace.id,
        format,
      });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const events =
    trace?.events.filter(
      (e) =>
        (kind === "all" || e.kind === kind) &&
        `${e.kind} ${e.tool ?? ""} ${e.summary} ${e.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="studio-toolbar">
        <Typography.Title level={4}>Runs · 执行记录</Typography.Title>
        <Space wrap className="trace-selector">
          <Select
            aria-label="选择执行记录"
            showSearch
            optionFilterProp="label"
            value={selected || undefined}
            placeholder="选择 Agent 或 Workflow 运行"
            style={{ width: "100%", minWidth: 280 }}
            onChange={setSelected}
            options={rows.map((r) => ({
              value: `${r.source}:${r.id}`,
              label: `${r.source === "agent" ? "Agent" : "Workflow"} · ${r.title} · ${statuses[r.status] ?? r.status} · ${new Date(r.createdAt).toLocaleString()}`,
            }))}
          />
          <Button onClick={() => setRevision((v) => v + 1)} disabled={loading}>
            刷新
          </Button>
        </Space>
      </div>
      {error && (
        <Alert
          type="error"
          title="执行证据加载失败"
          description={error}
          style={{ marginBottom: 12 }}
        />
      )}
      {loading ? (
        <div className="trace-placeholder">
          <Spin tip="正在加载执行证据">
            <div style={{ height: 100 }} />
          </Spin>
        </div>
      ) : !trace ? (
        <Empty description={error ? "点击刷新重试" : "选择运行查看执行证据"} />
      ) : (
        <>
          <section className="trace-summary" aria-label="运行概况">
            <Space
              wrap
              style={{ width: "100%", justifyContent: "space-between" }}
            >
              <Space>
                <Typography.Title level={4}>{trace.title}</Typography.Title>
                <Tag
                  color={
                    trace.status === "failed"
                      ? "error"
                      : trace.status === "unknown"
                        ? "warning"
                        : undefined
                  }
                >
                  {statuses[trace.status] ?? trace.status}
                </Tag>
              </Space>
              <Space>
                <Button
                  size="small"
                  loading={busy}
                  onClick={() => void exportTrace("json")}
                >
                  导出 Trace JSON
                </Button>
                <Button
                  size="small"
                  loading={busy}
                  onClick={() => void exportTrace("markdown")}
                >
                  导出 Trace Markdown
                </Button>
              </Space>
            </Space>
            <Typography.Paragraph>{trace.summary}</Typography.Paragraph>
            <Typography.Paragraph type="secondary">
              目标：{trace.target.kind === "ssh" ? trace.target.hostId : "本机"}{" "}
              · {trace.target.root} · 权限：{permissionLabels[trace.permission]}
            </Typography.Paragraph>
            <dl className="trace-metrics">
              {[
                ["工具请求", trace.metrics.toolCalls],
                ["工具失败", trace.metrics.toolFailures],
                ["模型调用", trace.metrics.modelCalls ?? "未采集"],
                ["人工批准", trace.metrics.humanApprovals],
                ["风险拦截", trace.metrics.riskBlocks],
                ["耗时", `${(trace.metrics.elapsedMs / 1000).toFixed(1)} 秒`],
                ["Token", trace.metrics.totalTokens ?? "未完整采集"],
                ["恢复核实", trace.metrics.recoveryAttempts],
                ["恢复后完成", trace.metrics.resumeSuccesses],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <Collapse
              size="small"
              items={[
                {
                  key: "versions",
                  label: "固定版本、目标与权限",
                  children: (
                    <pre className="output">
                      {JSON.stringify(
                        {
                          versions: trace.versions,
                          target: trace.target,
                          permission: trace.permission,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  ),
                },
              ]}
            />
          </section>
          <Space wrap className="trace-filters">
            <Input.Search
              aria-label="搜索执行事件"
              placeholder="搜索工具、摘要或 Evidence ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 300 }}
            />
            <Select
              aria-label="事件类型"
              value={kind}
              onChange={setKind}
              style={{ width: 210 }}
              options={[
                { value: "all", label: "全部事件" },
                ...Array.from(new Set(trace.events.map((e) => e.kind))).map(
                  (value) => ({ value, label: value }),
                ),
              ]}
            />
            <Typography.Text type="secondary">
              {events.length} / {trace.events.length} 条事件
            </Typography.Text>
          </Space>
          <Table<ExecutionEvent>
            aria-label="执行事件"
            size="small"
            rowKey="id"
            dataSource={events}
            scroll={{ x: 1080 }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            columns={[
              {
                title: "时间",
                dataIndex: "at",
                width: 160,
                render: (at) => new Date(at).toLocaleString(),
              },
              {
                title: "工具 / 类型",
                key: "tool",
                width: 180,
                render: (_, e) => (
                  <>
                    <Typography.Text code>{e.tool ?? e.kind}</Typography.Text>
                    {e.tool && <div className="muted">{e.kind}</div>}
                  </>
                ),
              },
              { title: "摘要", dataIndex: "summary", ellipsis: true },
              {
                title: "状态",
                key: "status",
                width: 90,
                render: (_, e) => (
                  <Typography.Text
                    type={
                      e.status === "failed"
                        ? "danger"
                        : e.status === "unknown"
                          ? "warning"
                          : undefined
                    }
                  >
                    {e.status ? (statuses[e.status] ?? e.status) : "—"}
                  </Typography.Text>
                ),
              },
              {
                title: "耗时",
                dataIndex: "durationMs",
                width: 85,
                render: (ms) =>
                  ms === undefined ? "—" : `${(ms / 1000).toFixed(2)} s`,
              },
              {
                title: "风险",
                key: "risk",
                width: 80,
                render: (_, e) =>
                  e.risk ? (
                    <Tooltip title={e.risk.reason}>
                      <Typography.Text
                        type={
                          e.risk.action === "deny"
                            ? "danger"
                            : e.risk.action === "confirm"
                              ? "warning"
                              : undefined
                        }
                      >
                        {e.risk.score}
                      </Typography.Text>
                    </Tooltip>
                  ) : (
                    "—"
                  ),
              },
              {
                title: "Evidence ID",
                key: "evidence",
                width: 135,
                render: (_, e) =>
                  e.evidenceId ? (
                    <Tooltip title={e.evidenceId}>
                      <Typography.Text code>
                        {e.evidenceId.slice(0, 12)}
                      </Typography.Text>
                    </Tooltip>
                  ) : (
                    "—"
                  ),
              },
            ]}
            expandable={{
              expandedRowRender: (e) => (
                <div className="trace-event-detail">
                  <Typography.Paragraph copyable>{e.id}</Typography.Paragraph>
                  {e.risk && <RiskDetails risk={e.risk} />}
                  <pre className="output">
                    {JSON.stringify(e.data ?? {}, null, 2)}
                  </pre>
                </div>
              ),
            }}
          />
          {!!trace.childTraceIds.length && (
            <Space wrap>
              <Typography.Text>关联子 Agent：</Typography.Text>
              {trace.childTraceIds.map((id) => (
                <Button
                  key={id}
                  size="small"
                  onClick={() => setSelected(`agent:${id}`)}
                >
                  {id.slice(0, 12)}
                </Button>
              ))}
            </Space>
          )}
        </>
      )}
    </>
  );
}
