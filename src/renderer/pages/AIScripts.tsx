import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Typography,
} from "antd";
import type { Snapshot, AgentResult } from "../../shared/types";
import { call, reportError } from "../api";
import Execution from "../components/Execution";
import ScriptEditor from "../components/ScriptEditor";
export default function AIScripts({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [providerId, setProvider] = useState("");
  const [hostId, setHost] = useState("");
  const [instruction, setInstruction] = useState("");
  const [context, setContext] = useState("");
  const [preview, setPreview] = useState<{
    instruction: string;
    context: string;
    token: string;
  }>();
  const [result, setResult] = useState<AgentResult>();
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState("");
  const previewSend = async () => {
    try {
      setPreview(
        await call("ai.preview", { providerId, instruction, context }),
      );
    } catch (e) {
      reportError(e);
    }
  };
  const send = async () => {
    const id = crypto.randomUUID();
    setRequestId(id);
    setBusy(true);
    setPreview(undefined);
    try {
      setResult(
        await call("ai.request", { providerId, ...preview, requestId: id }),
      );
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>AI 助手</Typography.Title>
          <p>诊断问题、理解日志、编写脚本；执行权始终在你手中</p>
        </div>
        <Tagline />
      </div>
      <div className="ai-layout">
        <Card title="诊断请求">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Select
              style={{ width: "100%" }}
              placeholder="选择模型或 Agent 接口"
              value={providerId || undefined}
              onChange={setProvider}
              options={data.providers.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
            />
            <Input.TextArea
              rows={4}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="描述运维需求，例如：分析 Nginx 502 的可能原因，先生成只读排查脚本"
            />
            <Select
              style={{ width: "100%" }}
              placeholder="可选：选择主机获取系统概览"
              value={hostId || undefined}
              onChange={setHost}
              options={data.hosts.map((h) => ({ value: h.id, label: h.name }))}
            />
            <Button
              disabled={!hostId}
              onClick={() =>
                call<any>("inspect", { hostId, kind: "overview" })
                  .then((r) => setContext(r.stdout))
                  .catch(reportError)
              }
            >
              读取系统概览到上下文
            </Button>
            <Input.TextArea
              rows={10}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="粘贴需要分析的日志或脚本；仅这里选定的内容会发送"
            />
            <Alert
              type="info"
              title="发送前预览"
              description="将对已保存凭据与常见密钥格式脱敏。请检查日志中是否仍包含敏感业务数据。"
            />
            <Space>
              <Button
                type="primary"
                disabled={!providerId || !instruction.trim()}
                loading={busy}
                onClick={previewSend}
              >
                预览并发送
              </Button>
              {busy && (
                <Button
                  onClick={() =>
                    call("ai.cancel", { requestId }).catch(reportError)
                  }
                >
                  取消请求
                </Button>
              )}
            </Space>
          </Space>
        </Card>
        <Card title="分析与脚本">
          <div className="ai-result">
            {result ? (
              <>
                <div className="prose">{result.summary}</div>
                {result.scripts.map((s, i) => (
                  <div className="generated-script" key={i}>
                    <Typography.Title level={5}>{s.name}</Typography.Title>
                    <p className="muted">{s.description}</p>
                    <ScriptEditor
                      value={s.body}
                      onChange={(body) =>
                        setResult((r) =>
                          r
                            ? {
                                ...r,
                                scripts: r.scripts.map((v, j) =>
                                  j === i ? { ...v, body } : v,
                                ),
                              }
                            : r,
                        )
                      }
                    />
                    <Space className="toolbar">
                      <Button
                        onClick={() =>
                          call("script.save", { name: s.name, body: s.body })
                            .then(refresh)
                            .catch(reportError)
                        }
                      >
                        保存到脚本库
                      </Button>
                      <Execution
                        key={`${i}-${s.body}-${hostId}`}
                        disabled={!hostId}
                        spec={{
                          hostId,
                          title: s.name,
                          script: s.body,
                          sudo: s.sudo,
                          timeout: 300,
                        }}
                        onDone={refresh}
                      />
                    </Space>
                  </div>
                ))}
              </>
            ) : (
              <div className="empty-illustration">
                <span>✦</span>
                <h3>从一个具体的问题开始</h3>
                <p>返回结果会显示在这里，脚本不会自动执行。</p>
              </div>
            )}
          </div>
        </Card>
      </div>
      <Modal
        title="确认发送到所选 API"
        width={760}
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        onOk={send}
        okText="发送"
      >
        <p className="prose">{preview?.instruction}</p>
        <pre className="output">{preview?.context || "未附加上下文"}</pre>
      </Modal>
    </>
  );
}
function Tagline() {
  return <span className="pill">✦ 确认后执行</span>;
}
