import { useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { Snapshot, TaskStatus } from "../../shared/types";
import { call, reportError } from "../api";
export const statusLabel: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  unknown: "状态待核实",
};
const colors: Record<TaskStatus, string> = {
  queued: "default",
  running: "processing",
  succeeded: "success",
  failed: "error",
  cancelled: "default",
  unknown: "warning",
};
export default function Tasks({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [id, setId] = useState<string>();
  const selected = data.tasks.find((t) => t.id === id);
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>任务中心</Typography.Title>
          <p>执行步骤、远端日志与恢复状态统一记录</p>
        </div>
        <Button onClick={refresh}>刷新</Button>
      </div>
      <Alert
        type="info"
        showIcon
        title="SSH 断线不代表任务失败。状态待核实的任务需重新核实，避免重复执行。"
        style={{ marginBottom: 20 }}
      />
      <Table
        rowKey="id"
        dataSource={[...data.tasks].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        )}
        columns={[
          {
            title: "任务",
            dataIndex: "title",
            render: (v, t) => (
              <Button type="link" onClick={() => setId(t.id)}>
                {v}
              </Button>
            ),
          },
          {
            title: "主机",
            dataIndex: "hostId",
            render: (id) => data.hosts.find((h) => h.id === id)?.name ?? id,
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (s: TaskStatus) => (
              <Tag color={colors[s]}>{statusLabel[s]}</Tag>
            ),
          },
          {
            title: "创建时间",
            dataIndex: "createdAt",
            render: (v) => new Date(v).toLocaleString(),
          },
          {
            title: "操作",
            render: (_, t) => (
              <Space>
                <Button
                  size="small"
                  onClick={() =>
                    call("task.reconcile", { id: t.id })
                      .then(refresh)
                      .catch(reportError)
                  }
                >
                  核实状态
                </Button>
                {["queued", "running", "unknown"].includes(t.status) && (
                  <Popconfirm
                    title="终止此任务？已产生的变更不会撤销。"
                    onConfirm={() =>
                      call("task.cancel", { id: t.id })
                        .then(refresh)
                        .catch(reportError)
                    }
                  >
                    <Button size="small" danger>
                      取消任务
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        open={!!selected}
        onClose={() => setId(undefined)}
        title={selected?.title}
        width="80%"
      >
        <Space>
          <Tag>{selected ? statusLabel[selected.status] : ""}</Tag>
          <span>退出码：{selected?.exitCode ?? "—"}</span>
          <span>{selected?.step}</span>
        </Space>
        <pre className="output">{selected?.logs || "等待远端日志…"}</pre>
      </Drawer>
    </>
  );
}
