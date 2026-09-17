import { useState } from "react";
import { Alert, Button, Descriptions, Modal, Space } from "antd";
import type { ExecutionPreview, ExecutionSpec } from "../../shared/types";
import { call, reportError } from "../api";
import ScriptEditor from "./ScriptEditor";
export default function Execution({
  spec,
  label = "预览执行",
  disabled = false,
  onDone,
}: {
  spec: ExecutionSpec;
  label?: string;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const [preview, setPreview] = useState<ExecutionPreview>();
  const [busy, setBusy] = useState(false);
  const begin = async () => {
    setBusy(true);
    try {
      setPreview(await call("execution.preview", spec));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      await call("execution.run", { token: preview!.token, spec });
      setPreview(undefined);
      onDone?.();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button type="primary" disabled={disabled} loading={busy} onClick={begin}>
        {label}
      </Button>
      <Modal
        title="确认远端执行"
        width={900}
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        footer={
          <Space>
            <Button onClick={() => setPreview(undefined)}>取消</Button>
            <Button danger type="primary" loading={busy} onClick={run}>
              确认执行此脚本
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {preview && (
          <>
            <Alert
              type="warning"
              showIcon
              title="请核对目标及完整脚本。取消任务不会撤销已发生的变更。"
            />
            <Descriptions
              size="small"
              column={2}
              style={{ margin: "16px 0" }}
              items={[
                { key: "host", label: "目标主机", children: preview.hostName },
                { key: "user", label: "执行用户", children: preview.username },
                {
                  key: "sudo",
                  label: "sudo",
                  children: preview.sudo ? "是" : "否",
                },
                {
                  key: "timeout",
                  label: "超时",
                  children: `${preview.timeout} 秒`,
                },
              ]}
            />
            <ScriptEditor value={preview.script} readOnly />
            <div className="muted mono">校验摘要：{preview.digest}</div>
          </>
        )}
      </Modal>
    </>
  );
}
