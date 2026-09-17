import { useEffect, useRef } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { call, reportError } from "../api";
export default function Terminal({ hostId }: { hostId: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Consolas, monospace",
      theme: { background: "#101827", foreground: "#d7e2f0" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current!);
    fit.fit();
    let id: string | undefined;
    let disposed = false;
    const unsub = window.sre.subscribe((e) => {
      if (e.type === "terminal" && e.id === id) term.write(e.data ?? "");
    });
    void call<any>("terminal.open", {
      hostId,
      cols: term.cols,
      rows: term.rows,
    })
      .then((r) => {
        id = typeof r === "string" ? r : r.id;
        if (disposed) void call("terminal.close", { id });
        else term.focus();
      })
      .catch((e) => {
        term.writeln(`\r\n${e.message}`);
      });
    const input = term.onData((data) => {
      if (id) void call("terminal.write", { id, data }).catch(reportError);
    });
    const resize = new ResizeObserver(() => {
      fit.fit();
      if (id)
        void call("terminal.resize", {
          id,
          cols: term.cols,
          rows: term.rows,
        }).catch(reportError);
    });
    resize.observe(box.current!);
    return () => {
      disposed = true;
      unsub();
      input.dispose();
      resize.disconnect();
      term.dispose();
      if (id) void call("terminal.close", { id }).catch(() => {});
    };
  }, [hostId]);
  return <div className="terminal" ref={box} />;
}
