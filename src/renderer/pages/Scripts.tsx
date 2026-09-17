import { useState } from "react";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import type { Snapshot } from "../../shared/types";
import { call, reportError } from "../api";
import ScriptEditor from "../components/ScriptEditor";
import Execution from "../components/Execution";
export default function Scripts({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => void;
}) {
  const [name, setName] = useState("主机巡检");
  const [body, setBody] = useState(
    "#!/usr/bin/env bash\nset -euo pipefail\nuname -a\nuptime\ndf -h\nfree -m\n",
  );
  const [hostId, setHost] = useState("");
  const [sudo, setSudo] = useState(false);
  const [timeout, setTimeout] = useState(300);
  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>脚本库</Typography.Title>
          <p>保存可复用脚本，核对内容后执行</p>
        </div>
      </div>
      <div className="editor-layout">
        <Card title="历史版本">
          <div className="script-list">
            {[...data.scripts].reverse().map((s) => (
              <Button
                key={s.id}
                block
                onClick={() => {
                  setName(s.name);
                  setBody(s.body);
                }}
              >
                {s.name} · v{s.version}
              </Button>
            ))}
            {!data.scripts.length && (
              <p className="muted">保存后显示版本历史</p>
            )}
          </div>
        </Card>
        <Card>
          <Space className="toolbar">
            <Input
              aria-label="脚本名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: 280 }}
            />
            <Button
              onClick={() =>
                call("script.save", { name, body })
                  .then(() => {
                    refresh();
                    void message.success("版本已保存");
                  })
                  .catch(reportError)
              }
            >
              保存新版本
            </Button>
          </Space>
          <ScriptEditor value={body} onChange={setBody} height="420px" />
          <Space wrap className="toolbar">
            <Select
              placeholder="选择目标主机"
              value={hostId || undefined}
              onChange={setHost}
              style={{ width: 200 }}
              options={data.hosts.map((h) => ({ value: h.id, label: h.name }))}
            />
            <span>sudo</span>
            <Switch checked={sudo} onChange={setSudo} />
            <span>超时（秒）</span>
            <InputNumber
              value={timeout}
              onChange={(v) => setTimeout(v ?? 300)}
              min={10}
              max={86400}
            />
            <Execution
              spec={{ hostId, title: name, script: body, sudo, timeout }}
              disabled={!hostId || !body.trim()}
              onDone={refresh}
            />
          </Space>
        </Card>
      </div>
    </>
  );
}
