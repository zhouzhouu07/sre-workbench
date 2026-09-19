import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import {
  environmentPreflight,
  installDocker,
} from "../src/main/features/environment";
import { deploymentFiles } from "../src/main/features/deployment";
import { monitoringFiles } from "../src/main/features/monitoring";
import type { DeploymentSpec, MonitoringStack } from "../src/shared/types";

// Execute the actual shell control flow; substitute only remote OS reads and commands.
function run(
  script: string,
  os = "rocky",
  version = "9.4",
  conflict = "",
  docker = false,
  compose = true,
) {
  const input = `
ID=${os}; VERSION_ID=${version}; VERSION_CODENAME=bookworm
uname() { echo x86_64; }
ps() { echo systemd; }
df() { printf 'Filesystem blocks used available\nx 9999999 1 9999998\n'; }
systemd-run() { :; }
getenforce() { echo Enforcing; }
firewall-cmd() { echo running; }
command() { if [[ "$*" = '-v docker' ]]; then return ${docker ? 0 : 1}; else builtin command "$@"; fi; }
rpm() { [[ "$*" = '-q ${conflict}' ]]; }
dnf() { echo "DNF $*"; }
apt-get() { echo "APT $*"; }
dpkg-query() { return 1; }
install() { :; }
curl() { :; }
chmod() { :; }
systemctl() { echo "SYSTEMCTL $*"; }
docker() { if [[ "$*" = 'compose version' ]]; then echo "DOCKER $*"; return ${compose ? 0 : 1}; else echo "DOCKER $*"; fi; }
${script.replace(". /etc/os-release", ":")}`;
  return spawnSync(
    process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash",
    ["-s"],
    { input, encoding: "utf8", timeout: 10000 },
  );
}

it("accepts Rocky 9.4 systemd hosts while retaining existing platforms", () => {
  for (const [os, version] of [
    ["rocky", "9.4"],
    ["ubuntu", "22.04"],
    ["ubuntu", "24.04"],
    ["debian", "12"],
  ]) {
    const result = run(environmentPreflight, os, version);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`OS=${os} ${version}`);
  }
  expect(run(environmentPreflight, "rocky", "8.10").status).toBe(1);
});

it("keeps deployed containers available after host reboot by enabling Docker", () => {
  const result = run(installDocker, "rocky", "9.4", "", true);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("SYSTEMCTL enable --now docker");
});

it("installs Docker and Compose from the official Rocky-documented RPM repository", () => {
  const result = run(installDocker);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(
    "DNF config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo",
  );
  expect(result.stdout).toContain(
    "DNF install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
  );
  expect(result.stdout).toContain("DOCKER compose version");
  expect(result.stdout).not.toContain("APT");
});

it.each([
  "podman",
  "podman-docker",
  "runc",
  "containerd",
  "docker",
  "moby-engine",
])("refuses conflicting %s without removing or installing packages", (pkg) => {
  const result = run(installDocker, "rocky", "9.4", pkg);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("不会移除");
  expect(result.stdout).not.toContain("DNF");
});

it("rejects a podman Docker shim even when a docker executable exists", () => {
  const result = run(installDocker, "rocky", "9.4", "podman-docker", true);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("不会移除");
});

it("reuses installed Docker but refuses missing Compose without changing RPM packages", () => {
  expect(run(installDocker, "rocky", "9.4", "", true).status).toBe(0);
  const result = run(installDocker, "rocky", "9.4", "", true, false);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("缺少 Compose");
  expect(result.stdout).not.toContain("DNF");
});

it("reports SELinux and firewalld prerequisites without changing policy", () => {
  const result = run(environmentPreflight);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("SELinux=Enforcing");
  expect(result.stdout).toContain("firewalld=running");
  expect(result.stdout).toContain("9100");
  expect(result.stdout).toContain("用户数据目录");
});

const deployment: DeploymentSpec = {
  id: "app",
  hostId: "h",
  name: "App",
  sourceType: "local",
  source: "/app",
  gitRef: "main",
  template: "node",
  runtime: "22",
  installCommand: "",
  buildCommand: "",
  startCommand: "node index.js",
  outputDir: "dist",
  containerPort: 3000,
  publicPort: 8080,
  domain: "",
  healthPath: "/",
  env: {},
  volumes: [{ source: "/srv/data", target: "/data" }],
};
const monitoring: MonitoringStack = {
  id: "mon",
  hostId: "h",
  name: "Monitoring",
  targets: [],
  retentionDays: 15,
  cpuThreshold: 80,
  memoryThreshold: 80,
  diskThreshold: 80,
  duration: "5m",
  groupWait: "30s",
  groupInterval: "5m",
  repeatInterval: "4h",
  smtpHost: "smtp.example:587",
  smtpEnabled: false,
  smtpFrom: "ops@example.com",
  smtpTo: "ops@example.com",
  smtpUser: "ops",
  webhook: "",
};

it("shares SELinux labels only on workbench-owned bind mounts", () => {
  const files = deploymentFiles(deployment, "release");
  expect(parse(files["proxy.yml"]).services.caddy.volumes[0]).toBe(
    "/opt/sre-workbench/deployments/app/routing:/etc/caddy:ro,z",
  );
  expect(parse(files["compose.yml"]).services.app.volumes[0].bind).toEqual({
    create_host_path: false,
  });
  const services = parse(
    monitoringFiles(monitoring, "", "pw")["compose.yml"],
  ).services;
  for (const service of Object.values(services) as { volumes: string[] }[]) {
    for (const mount of service.volumes.filter((v) => v.startsWith("/opt/")))
      expect(mount.endsWith(":ro,z")).toBe(true);
  }
});

it("omits email configuration when SMTP is explicitly disabled, retaining legacy behavior", () => {
  expect(
    parse(monitoringFiles(monitoring, "", "pw")["alertmanager.yml"])
      .receivers[0].email_configs,
  ).toBeUndefined();
  expect(
    parse(
      monitoringFiles({ ...monitoring, smtpEnabled: undefined }, "", "pw")[
        "alertmanager.yml"
      ],
    ).receivers[0].email_configs,
  ).toHaveLength(1);
});
