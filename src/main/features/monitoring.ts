import { stringify } from "yaml";
import type { MonitoringStack } from "../../shared/types";
import { shellQuote as q } from "../core/safety";

export const monitoringPorts = (s: MonitoringStack) => ({
  grafana: s.grafanaPort ?? 3000,
  prometheus: s.prometheusPort ?? 9090,
  alertmanager: s.alertmanagerPort ?? 9093,
});

export const monitorBase = (id: string) =>
  "/opt/sre-workbench/monitoring/" + id;
export function monitoringFiles(
  s: MonitoringStack,
  smtpPassword: string,
  grafanaPassword: string,
): Record<string, string> {
  const base = monitorBase(s.id);
  const files: Record<string, string> = {};
  const address = (host: string) =>
    host.includes(":") ? "[" + host + "]" : host;
  files["prometheus.yml"] = stringify({
    global: { scrape_interval: "15s", evaluation_interval: "15s" },
    rule_files: ["/etc/prometheus/rules.yml"],
    alerting: {
      alertmanagers: [{ static_configs: [{ targets: ["alertmanager:9093"] }] }],
    },
    scrape_configs: [
      {
        job_name: "prometheus",
        static_configs: [{ targets: ["localhost:9090"] }],
      },
      {
        job_name: "node",
        static_configs: s.targets.map((t) => ({
          targets: [address(t.address) + ":9100"],
          labels: { host_id: t.hostId },
        })),
      },
    ],
  });
  files["rules.yml"] = stringify({
    groups: [
      {
        name: "node",
        rules: [
          {
            alert: "NodeDown",
            expr: 'up{job="node"} == 0',
            for: s.duration,
            labels: { severity: "critical" },
            annotations: { summary: "主机 {{ $labels.instance }} 不可达" },
          },
          {
            alert: "HighCPU",
            expr: `100 * (1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))) > ${s.cpuThreshold}`,
            for: s.duration,
            labels: { severity: "warning" },
            annotations: { summary: "CPU 使用率过高" },
          },
          {
            alert: "HighMemory",
            expr: `100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) > ${s.memoryThreshold}`,
            for: s.duration,
            labels: { severity: "warning" },
            annotations: { summary: "内存使用率过高" },
          },
          {
            alert: "HighDisk",
            expr: `100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}) > ${s.diskThreshold}`,
            for: s.duration,
            labels: { severity: "warning" },
            annotations: { summary: "磁盘使用率过高" },
          },
        ],
      },
    ],
  });
  const receiver: Record<string, unknown> = { name: "notifications" };
  if (s.smtpEnabled ?? !!s.smtpHost)
    receiver.email_configs = [
      {
        to: s.smtpTo,
        from: s.smtpFrom,
        smarthost: s.smtpHost,
        auth_username: s.smtpUser,
        ...(smtpPassword
          ? { auth_password_file: "/etc/alertmanager/secrets/smtp_password" }
          : {}),
        // Alertmanager 0.28.1 dials TLS directly on 465. Requiring STARTTLS
        // there attempts a second upgrade which implicit-TLS servers reject.
        require_tls: !s.smtpHost.endsWith(":465"),
        send_resolved: true,
      },
    ];
  if (s.webhook)
    receiver.webhook_configs = [{ url: s.webhook, send_resolved: true }];
  files["alertmanager.yml"] = stringify({
    route: {
      receiver: "notifications",
      group_by: ["alertname", "instance"],
      group_wait: s.groupWait,
      group_interval: s.groupInterval,
      repeat_interval: s.repeatInterval,
    },
    receivers: [receiver],
  });
  files["secrets/smtp_password"] = smtpPassword;
  files["secrets/grafana_password"] = grafanaPassword;
  files["provisioning/datasources/default.yml"] = stringify({
    apiVersion: 1,
    datasources: [
      {
        name: "Prometheus",
        uid: "prometheus",
        type: "prometheus",
        access: "proxy",
        url: "http://prometheus:9090",
        isDefault: true,
        editable: false,
      },
    ],
  });
  files["provisioning/dashboards/default.yml"] = stringify({
    apiVersion: 1,
    providers: [
      {
        name: "SRE",
        type: "file",
        disableDeletion: true,
        options: { path: "/var/lib/grafana/dashboards" },
      },
    ],
  });
  const metrics = [
    [
      "CPU 使用率",
      '100 * (1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))',
    ],
    [
      "内存使用率",
      "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
    ],
    [
      "磁盘使用率",
      '100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})',
    ],
    [
      "网络接收字节/秒",
      'sum by(instance) (rate(node_network_receive_bytes_total{device!="lo"}[5m]))',
    ],
  ];
  files["dashboards/node.json"] = JSON.stringify({
    uid: "sre-nodes",
    title: "SRE 主机概览",
    schemaVersion: 39,
    version: 1,
    refresh: "30s",
    time: { from: "now-1h", to: "now" },
    panels: metrics.map(([title, expr], i) => ({
      id: i + 1,
      title,
      type: "timeseries",
      datasource: { type: "prometheus", uid: "prometheus" },
      gridPos: { x: (i % 2) * 12, y: Math.floor(i / 2) * 9, w: 12, h: 9 },
      targets: [{ refId: "A", expr, legendFormat: "{{instance}}" }],
      fieldConfig: {
        defaults: { unit: i === 3 ? "Bps" : "percent" },
        overrides: [],
      },
    })),
  });
  const config = (name: string, target: string) =>
    `${base}/${name}:${target}:ro,z`;
  files["compose.yml"] = stringify({
    name: "sre-mon-" + s.id,
    services: {
      prometheus: {
        image: "prom/prometheus:v3.2.1",
        restart: "unless-stopped",
        command: [
          "--config.file=/etc/prometheus/prometheus.yml",
          `--storage.tsdb.retention.time=${s.retentionDays}d`,
          "--storage.tsdb.path=/prometheus",
        ],
        ports: [`127.0.0.1:${monitoringPorts(s).prometheus}:9090`],
        volumes: [
          config("prometheus.yml", "/etc/prometheus/prometheus.yml"),
          config("rules.yml", "/etc/prometheus/rules.yml"),
          "prometheus-data:/prometheus",
        ],
      },
      alertmanager: {
        image: "prom/alertmanager:v0.28.1",
        restart: "unless-stopped",
        command: [
          "--config.file=/etc/alertmanager/alertmanager.yml",
          "--storage.path=/alertmanager",
        ],
        ports: [`127.0.0.1:${monitoringPorts(s).alertmanager}:9093`],
        volumes: [
          config("alertmanager.yml", "/etc/alertmanager/alertmanager.yml"),
          config("secrets", "/etc/alertmanager/secrets"),
          "alertmanager-data:/alertmanager",
        ],
      },
      grafana: {
        image: "grafana/grafana:11.6.0",
        restart: "unless-stopped",
        environment: {
          GF_SECURITY_ADMIN_USER: s.grafanaUsername ?? "admin",
          GF_SECURITY_ADMIN_PASSWORD__FILE: "/run/secrets/grafana_password",
          GF_USERS_ALLOW_SIGN_UP: "false",
        },
        ports: [`127.0.0.1:${monitoringPorts(s).grafana}:3000`],
        volumes: [
          config("secrets/grafana_password", "/run/secrets/grafana_password"),
          config("provisioning", "/etc/grafana/provisioning"),
          config("dashboards", "/var/lib/grafana/dashboards"),
          "grafana-data:/var/lib/grafana",
        ],
      },
    },
    volumes: {
      "prometheus-data": {},
      "alertmanager-data": {},
      "grafana-data": {},
    },
  });
  return files;
}
export function exporterScript(id: string, bind: string): string {
  const listen = bind.includes(":") ? "[" + bind + "]:9100" : bind + ":9100";
  return `set -euo pipefail\ncommand -v docker >/dev/null\ndocker compose version >/dev/null\nmkdir -p /opt/sre-workbench/exporter\ncat > /opt/sre-workbench/exporter/compose.yml <<'SRE_EXPORTER'\n${stringify({ name: "sre-node-exporter", services: { node: { image: "prom/node-exporter:v1.9.0", restart: "unless-stopped", network_mode: "host", pid: "host", command: ["--path.rootfs=/host", "--web.listen-address=" + listen], volumes: ["/:/host:ro,rslave"], labels: { "sre.target": id } } } })}SRE_EXPORTER\ndocker compose -f /opt/sre-workbench/exporter/compose.yml up -d\nfor attempt in $(seq 1 30); do\n if curl -fsS --max-time 5 ${q("http://" + (bind.includes(":") ? "[" + bind + "]" : bind) + ":9100/metrics")} >/dev/null; then exit 0; fi\n sleep 2\ndone\necho 'Exporter readiness check failed'; exit 1\n`;
}
export function monitoringScript(s: MonitoringStack, stage: string): string {
  const base = monitorBase(s.id);
  return `set -euo pipefail
umask 077
base=${q(base)}
if test -f "$base/compose.yml"; then
 backup="$base/backups/$(date -u +%Y%m%dT%H%M%S)-$$"
 mkdir -p -m 700 "$backup"
 for item in compose.yml prometheus.yml alertmanager.yml rules.yml secrets provisioning dashboards; do
  if test -e "$base/$item"; then cp -a "$base/$item" "$backup/"; fi
 done
fi
install -d -m 0755 "$base"
cp -a -- ${q(stage + "/.")} "$base/"
chmod 755 "$base"
find "$base/provisioning" "$base/dashboards" -type d -exec chmod 755 {} +
find "$base/provisioning" "$base/dashboards" -type f -exec chmod 644 {} +
chmod 644 "$base/prometheus.yml" "$base/rules.yml" "$base/compose.yml"
chmod 700 "$base/secrets"
chown 65534:65534 "$base/alertmanager.yml" "$base/secrets/smtp_password"
chmod 600 "$base/alertmanager.yml" "$base/secrets/smtp_password" "$base/secrets/grafana_password"
chown 472:472 "$base/secrets/grafana_password"
chmod 711 "$base/secrets"
${s.targets.map((t) => `curl -fsS --max-time 15 ${q("http://" + t.address + ":9100/metrics")} >/dev/null`).join("\n")}
docker run --rm -v "$base:/etc/prometheus:ro,z" --entrypoint /bin/promtool prom/prometheus:v3.2.1 check config /etc/prometheus/prometheus.yml
docker run --rm -v "$base:/etc/alertmanager:ro,z" --entrypoint /bin/amtool prom/alertmanager:v0.28.1 check-config /etc/alertmanager/alertmanager.yml
docker compose -f "$base/compose.yml" config --quiet
docker compose -f "$base/compose.yml" up -d --force-recreate
for port in ${monitoringPorts(s).prometheus} ${monitoringPorts(s).alertmanager} ${monitoringPorts(s).grafana}; do
 ok=0
 for attempt in $(seq 1 60); do
  case "$port" in ${monitoringPorts(s).grafana}) route=/api/health;; *) route=/-/ready;; esac
  if curl -fsS --max-time 3 "http://127.0.0.1:$port$route" >/dev/null; then ok=1; break; fi
  sleep 2
 done
 test "$ok" = 1 || { echo "Monitoring health check failed: $port"; exit 1; }
done
echo 'Monitoring services healthy. Existing Grafana administrator password remains managed by Grafana.'
`;
}
