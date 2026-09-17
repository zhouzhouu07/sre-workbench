import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/shell/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
(self as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
export default function ScriptEditor({
  value,
  onChange,
  height = "300px",
  readOnly = false,
}: {
  value: string;
  onChange?: (s: string) => void;
  height?: string;
  readOnly?: boolean;
}) {
  return (
    <Editor
      height={height}
      language="shell"
      value={value}
      onChange={(v) => onChange?.(v ?? "")}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        readOnly,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 12 },
      }}
    />
  );
}
