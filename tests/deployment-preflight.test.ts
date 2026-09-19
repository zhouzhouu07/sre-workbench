import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  deploymentPreflightScript,
  parseDeploymentPreflight,
} from "../src/main/features/environment";
const spec = { id: "demo", domain: "", publicPort: 8080, volumes: [] } as any;
function inspect(overrides = "", target = spec) {
  const script = deploymentPreflightScript(target).replace(
    ". /etc/os-release",
    "ID=rocky; VERSION_ID=9.4",
  );
  const result = spawnSync(
    process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash",
    ["-s"],
    {
      encoding: "utf8",
      timeout: 10000,
      input: `
 id() { echo 0; }; uname() { echo x86_64; }; ps() { echo systemd; }
 df() { printf 'Filesystem blocks used available\\nx 9999999 1 9999998\\n'; }
 awk() { if [[ "$*" = *MemAvailable* ]]; then echo 2097152; else command awk "$@"; fi; }
 systemd-run() { :; }; systemctl() { :; }; ss() { :; }; rpm() { return 1; }; dnf() { :; }
 docker() { :; }; getenforce() { echo Enforcing; }
 ${overrides}
 ${script}`,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return parseDeploymentPreflight(result.stdout);
}
it("reports a ready host without making changes and allows Docker auto-install as an explicit warning", () => {
  const checks = inspect(
    `command() { if [[ "$*" = '-v docker' ]]; then return 1; else builtin command "$@"; fi; }`,
  );
  expect(checks.some((c) => c.status === "fail")).toBe(false);
  expect(checks.find((c) => c.id === "docker")?.status).toBe("warn");
});
it("blocks unsupported OS, scarce disk and occupied unmanaged ports", () => {
  const checks = inspect(
    `uname() { echo aarch64; }; df() { printf 'Filesystem blocks used available\\nx 100 1 99\\n'; }; ss() { echo LISTEN; }; docker() { :; }`,
  );
  expect(checks.find((c) => c.id === "platform")?.status).toBe("fail");
  expect(checks.find((c) => c.id === "disk-/var")?.status).toBe("fail");
  expect(checks.find((c) => c.id === "port-8080")?.status).toBe("fail");
});
it("allows a port already published by the same project", () => {
  const checks = inspect(
    `ss() { echo LISTEN; }; docker() { if [[ "$*" = ps* ]]; then printf 'sre-proxy-demo\\t0.0.0.0:8080->80/tcp\\n'; fi; }`,
  );
  expect(checks.find((c) => c.id === "port-8080")?.status).toBe("pass");
});
it("fails closed on an incomplete report", () => {
  expect(() => parseDeploymentPreflight("")).toThrow();
});

it("does not block missing unused tar but requires task log tools", () => {
  expect(
    inspect(
      `command() { if [[ "$*" = '-v tar' ]]; then return 1; else builtin command "$@"; fi; }`,
    ).find((c) => c.id === "tools")?.status,
  ).toBe("pass");
  expect(
    inspect(
      `command() { if [[ "$*" = '-v stdbuf' ]]; then return 1; else builtin command "$@"; fi; }`,
    ).find((c) => c.id === "tools")?.status,
  ).toBe("fail");
});
it("warns about active firewalld and curl installation", () => {
  const checks = inspect(
    `firewall-cmd() { echo running; }; command() { if [[ "$*" = '-v curl' ]]; then return 1; else builtin command "$@"; fi; }`,
  );
  expect(checks.find((c) => c.id === "firewall")?.status).toBe("warn");
  expect(checks.find((c) => c.id === "curl")?.status).toBe("warn");
});
it("blocks domain UDP 443 collisions even when TCP is free", () => {
  const checks = inspect(
    `getent() { echo 192.0.2.1; }; ss() { if [[ "$*" = *-lun* ]]; then echo UNCONN; fi; }`,
    { ...spec, domain: "example.com" },
  );
  expect(checks.find((c) => c.id === "port-443-udp")?.status).toBe("fail");
});
it("detects NAT-only published ports and excludes only the exact project", () => {
  for (const project of ["other", "sre-proxy-demo-extra", ""]) {
    const checks = inspect(
      `docker() { if [[ "$1" = ps ]]; then printf '%s\\t%s\\n' '${project}' '0.0.0.0:8080->80/tcp'; fi; }`,
    );
    expect(checks.find((c) => c.id === "port-8080")?.status).toBe("fail");
  }
  const own = inspect(
    `docker() { if [[ "$1" = ps ]]; then printf 'sre-proxy-demo\\t0.0.0.0:8080->80/tcp\\n'; fi; }`,
  );
  expect(own.find((c) => c.id === "port-8080")?.status).toBe("pass");
});
it("does not allow own UDP publication to hide an unmanaged TCP listener", () => {
  const checks = inspect(
    `ss() { echo LISTEN; }; docker() { if [[ "$1" = ps ]]; then printf 'sre-proxy-demo\\t0.0.0.0:8080->80/udp\\n'; fi; }`,
  );
  expect(checks.find((c) => c.id === "port-8080")?.status).toBe("fail");
});
it("detects NAT-only UDP domain mappings and published port ranges", () => {
  const checks = inspect(
    `getent() { echo 192.0.2.1; }; docker() { if [[ "$1" = ps ]]; then printf 'other\\t0.0.0.0:440-445->440-445/udp\\n'; fi; }`,
    { ...spec, domain: "example.com" },
  );
  expect(checks.find((c) => c.id === "port-443-udp")?.status).toBe("fail");
  expect(checks.find((c) => c.id === "port-443")?.status).toBe("pass");
});
it("fails closed when Docker port queries fail but warns when daemon is stopped", () => {
  const failed = inspect(`docker() { if [[ "$1" = ps ]]; then return 1; fi; }`);
  expect(failed.find((c) => c.id === "port-8080")?.status).toBe("fail");
  const stopped = inspect(
    `docker() { if [[ "$1" = info || "$1" = ps ]]; then return 1; fi; }`,
  );
  expect(stopped.find((c) => c.id === "docker")?.status).toBe("warn");
  expect(stopped.find((c) => c.id === "port-8080")?.status).toBe("warn");
});
