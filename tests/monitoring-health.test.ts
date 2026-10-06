import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { monitoringScript } from "../src/main/features/monitoring";
import type { MonitoringStack } from "../src/shared/types";

const stack: MonitoringStack = {
  id: "11111111-1111-4111-8111-111111111111",
  hostId: "h",
  name: "monitor",
  targets: [{ hostId: "h", address: "192.0.2.10" }],
  retentionDays: 15,
  cpuThreshold: 85,
  memoryThreshold: 1,
  diskThreshold: 90,
  duration: "1m",
  groupWait: "30s",
  groupInterval: "5m",
  repeatInterval: "4h",
  smtpEnabled: false,
  smtpHost: "",
  smtpFrom: "",
  smtpTo: "",
  smtpUser: "",
  webhook: "",
};
function run(failed = "") {
  // Run the product's Bash control flow; fake external commands and filesystem writes.
  const fixture = `
test() { case "$*" in '-f '*|'-e '*) return 1;; *) builtin test "$@";; esac; }
install() { :; }; cp() { :; }; chmod() { :; }; chown() { :; }; find() { :; }
seq() { echo 1; }; sleep() { :; }
docker() { :; }
curl() {
  case "$*" in
    *3000/api/health*) printf '%s' '${failed === "grafana" ? '\{"database":"failed"\}' : '\{"database":"ok"\}'}';;
    *9090/-/ready*) ${failed === "prometheus" ? "return 7" : "echo ready"};;
    *9093/-/ready*) ${failed === "alertmanager" ? "return 7" : "echo ready"};;
    *9100/metrics*) ${failed === "exporter" ? "return 7" : "echo 'node_uname_info{sysname=\"Linux\"} 1'"};;
  esac
}
${monitoringScript(stack, "/tmp/sre-stage-fixture")}`;
  return spawnSync(
    process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash",
    ["-s"],
    { input: fixture, encoding: "utf8", timeout: 10000 },
  );
}
describe("monitoring business health", () => {
  it.each(["grafana", "prometheus", "alertmanager", "exporter"])(
    "rejects Compose exit zero when %s verification fails",
    (service) => {
      const r = run(service);
      expect(r.status, r.stderr).not.toBe(0);
      expect(r.stdout).not.toContain("Monitoring services healthy");
      expect(r.stdout + r.stderr).toMatch(
        /验收失败|readiness|health check failed/i,
      );
    },
  );
  it("requires all component evidence before success", () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    for (const service of ["grafana", "prometheus", "alertmanager", "exporter"])
      expect(r.stdout).toContain(`SRE_MONITOR_CHECK\t${service}\tready`);
  });
});
