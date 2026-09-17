import { useEffect, useState } from "react";
import { Alert, Button, Card, Drawer, Space, Tag } from "antd";
import type { Snapshot, Task } from "../../shared/types";
import { call } from "../api";
import { statusLabel } from "../pages/Tasks";

/** Keep the submitted task visible while the backend collects its remote result. */
export default function TaskFeedback({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(tasks);
  const [error, setError] = useState("");
  useEffect(() => {
    setCurrent(tasks);
    setError("");
    if (tasks.length) setOpen(true);
  }, [tasks]);
  useEffect(() => {
    if (!tasks.length || !open) return;
    let disposed = false,
      loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const snapshot = await call<Snapshot>("snapshot");
        if (!disposed) {
          setCurrent((previous) =>
            tasks.map(
              (t) =>
                snapshot.tasks.find((s) => s.id === t.id) ??
                previous.find((s) => s.id === t.id) ??
                t,
            ),
          );
          setError("");
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      } finally {
        loading = false;
      }
    };
    void refresh();
    const off = window.sre?.subscribe((e) => {
      if (e.type === "changed") void refresh();
    });
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      off?.();
      clearInterval(timer);
    };
  }, [tasks, open]);
  if (!tasks.length) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>查看执行结果</Button>
      <Drawer
        title="执行反馈"
        width="80%"
        open={open}
        onClose={() => setOpen(false)}
      >
        {error && (
          <Alert
            type="warning"
            showIcon
            title="暂时无法刷新执行状态"
            description={error}
          />
        )}
        {current.map((task) => (
          <Card key={task.id} title={task.title} style={{ marginBottom: 16 }}>
            <Space wrap>
              <Tag
                color={
                  task.status === "succeeded"
                    ? "success"
                    : task.status === "failed"
                      ? "error"
                      : task.status === "unknown"
                        ? "warning"
                        : "processing"
                }
              >
                {statusLabel[task.status]}
              </Tag>
              <span>退出码：{task.exitCode ?? "—"}</span>
              <span>{task.step}</span>
            </Space>
            {task.status === "unknown" && (
              <Alert
                type="warning"
                title="连接中断不代表执行失败，请到任务中心核实状态，避免重复执行。"
              />
            )}
            <pre className="output">
              {task.logs || "任务已提交，等待远端日志…"}
            </pre>
          </Card>
        ))}
        <p className="muted">任务和日志已记录，可在任务中心继续查看。</p>
      </Drawer>
    </>
  );
}
