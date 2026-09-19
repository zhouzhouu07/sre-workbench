import type {
  DeploymentSpec,
  DeploymentPreflightCheck,
} from "../../shared/types";
import { shellQuote as q } from "../core/safety";

/** Run only inside a user-confirmed remote task as root. */
export const installDocker = `set -euo pipefail
. /etc/os-release
case "$ID:$VERSION_ID:$(uname -m)" in ubuntu:22.04:x86_64|ubuntu:24.04:x86_64|debian:12:x86_64|rocky:9.4:x86_64) ;; *) echo '仅支持 Ubuntu 22.04/24.04、Debian 12、Rocky Linux 9.4 x86_64'; exit 1;; esac
if test "$ID" = rocky; then
  for package in docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman podman-docker containerd runc moby-engine; do
    if rpm -q "$package" >/dev/null 2>&1; then
      echo "检测到现有容器运行时包 $package，请先由管理员核实兼容性；工作台不会移除这些包"; exit 1
    fi
  done
  if ! command -v docker >/dev/null; then
    dnf install -y dnf-plugins-core ca-certificates
    dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
    dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif ! docker compose version >/dev/null 2>&1; then
    echo '现有 Docker 缺少 Compose 插件，请管理员安装兼容的 docker-compose-plugin 后重试'; exit 1
  fi
  if ! command -v curl >/dev/null; then dnf install -y curl; fi
else
export DEBIAN_FRONTEND=noninteractive
if ! command -v curl >/dev/null; then apt-get update; apt-get install -y ca-certificates curl; fi
if ! command -v docker >/dev/null; then
  if dpkg-query -W -f='\${Status}' docker.io podman-docker containerd runc 2>/dev/null | grep -q 'install ok installed'; then
    echo '检测到现有容器运行时包，请先由管理员核实兼容性；工作台不会移除这些包'; exit 1
  fi
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL --max-time 60 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/sre-docker.asc
  chmod a+r /etc/apt/keyrings/sre-docker.asc
  printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/sre-docker.asc] https://download.docker.com/linux/%s %s stable\\n' "$ID" "$VERSION_CODENAME" > /etc/apt/sources.list.d/sre-docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
elif ! docker compose version >/dev/null 2>&1; then
  echo '现有 Docker 缺少 Compose 插件，请管理员安装兼容的 docker-compose-plugin 后重试'; exit 1
fi
fi
systemctl enable --now docker
docker info >/dev/null
docker compose version
`;
export const environmentPreflight = `set -eu
. /etc/os-release
case "$ID:$VERSION_ID:$(uname -m)" in ubuntu:22.04:x86_64|ubuntu:24.04:x86_64|debian:12:x86_64|rocky:9.4:x86_64) ;; *) echo '仅支持 Ubuntu 22.04/24.04、Debian 12、Rocky Linux 9.4 x86_64' >&2; exit 1;; esac
command -v systemd-run >/dev/null
test "$(ps -p 1 -o comm= | tr -d ' ')" = systemd
available=$(df -Pk /var | awk 'NR==2 {print $4}')
test "$available" -ge 2097152 || { echo '/var 至少需要 2 GiB 可用空间' >&2; exit 1; }
printf 'OS=%s %s; ARCH=%s; available=%s KiB\\n' "$ID" "$VERSION_ID" "$(uname -m)" "$available"
if test "$ID" = rocky; then
  if command -v getenforce >/dev/null; then printf 'SELinux=%s\\n' "$(getenforce)"; fi
  if command -v firewall-cmd >/dev/null; then printf 'firewalld=%s\\n' "$(firewall-cmd --state 2>/dev/null || true)"; fi
  echo '保留 SELinux 与防火墙策略。用户数据目录需由管理员准备兼容的容器标签；不会自动重标记用户目录或主机根目录。'
  echo '请核实应用公网端口及监控服务器到 exporter TCP 9100 的访问策略；Docker 发布端口可能绕过常规主机入站规则。'
fi
`;

/** Read-only inspection: no installs, daemon starts, directory creation or relabeling. */
export function deploymentPreflightScript(s: DeploymentSpec): string {
  const ports = s.domain ? [80, 443] : [s.publicPort];
  return `set -u
emit() { printf 'SRE_CHECK\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3"; }
if test "$(id -u)" = 0; then emit privilege pass 'root/sudo 权限可用'; else emit privilege fail '需要 root 或可用的 sudo 权限'; fi
. /etc/os-release
case "$ID:$VERSION_ID:$(uname -m)" in ubuntu:22.04:x86_64|ubuntu:24.04:x86_64|debian:12:x86_64|rocky:9.4:x86_64) emit platform pass "$ID $VERSION_ID $(uname -m)";; *) emit platform fail '仅支持 Ubuntu 22.04/24.04、Debian 12、Rocky 9.4 x86_64';; esac
if command -v systemd-run >/dev/null && command -v systemctl >/dev/null && test "$(ps -p 1 -o comm= | tr -d ' ')" = systemd; then emit systemd pass 'systemd 可用'; else emit systemd fail '需要以 systemd 为 PID 1 并提供 systemd-run/systemctl'; fi
missing=''
for tool in bash ss df awk head dd stdbuf base64 grep ps tr uname id; do command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"; done
if test -z "$missing"; then emit tools pass '基本工具可用'; else emit tools fail "缺少工具:$missing"; fi
if command -v curl >/dev/null 2>&1; then emit curl pass 'curl 可用'; else emit curl warn '未安装 curl，确认部署后将按需安装；需要软件源网络可达'; fi
for path in /var /opt /tmp; do
 available=$(df -Pk "$path" 2>/dev/null | awk 'NR==2 {print $4}')
 case "$available" in ''|*[!0-9]*) emit "disk-$path" fail "$path 可用空间无法读取";; *) if test "$available" -ge 2097152; then emit "disk-$path" pass "$path 可用 $available KiB"; else emit "disk-$path" fail "$path 至少需要 2 GiB 可用空间，当前 $available KiB"; fi;; esac
done
memory=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null)
if test "$memory" -ge 1048576 2>/dev/null; then emit memory pass "可用内存 $memory KiB"; else emit memory warn '可用内存不足 1 GiB 或无法读取，镜像构建可能失败'; fi
conflicts=''
if test "$ID" = rocky; then
 for package in docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman podman-docker containerd runc moby-engine; do
  if rpm -q "$package" >/dev/null 2>&1; then conflicts="$conflicts $package"; fi
 done
elif ! command -v docker >/dev/null 2>&1; then
 if dpkg-query -W -f='\${Status}' docker.io podman-docker containerd runc 2>/dev/null | grep -q 'install ok installed'; then conflicts='现有发行版容器运行时'; fi
fi
if test -n "$conflicts"; then emit runtime-conflicts fail "容器运行时包冲突:$conflicts；请管理员核实，工作台不会移除"; else emit runtime-conflicts pass '未发现已知容器运行时冲突'; fi
docker_state=absent
if ! command -v docker >/dev/null 2>&1; then
 emit docker warn '未安装 Docker，确认部署后将安装 Docker 和 Compose；需要软件源网络可达'
else
 if docker compose version >/dev/null 2>&1; then emit compose pass 'Compose 插件可用'; else emit compose fail '现有 Docker 缺少 Compose 插件，请管理员安装兼容插件'; fi
 if docker info >/dev/null 2>&1; then docker_state=ready; emit docker pass 'Docker daemon 可用'; else docker_state=stopped; emit docker warn 'Docker daemon 当前不可用，部署会尝试启动；若配置损坏仍可能失败'; fi
fi
docker_ports=''
if test "$docker_state" = ready; then
 if ! docker_ports=$(docker ps --format '{{.Label "com.docker.compose.project"}}\t{{.Ports}}' 2>/dev/null); then docker_state=query-failed; fi
fi
check_port() {
 port=$1; protocol=$2; check_id=$3
 if test "$protocol" = tcp; then flags=-ltn; else flags=-lun; fi
 if ! occupied=$(ss -H "$flags" "sport = :$port" 2>/dev/null); then emit "$check_id" fail "无法检查 $protocol $port"; return; fi
 if test "$docker_state" = query-failed; then emit "$check_id" fail "Docker 端口查询失败，无法核实 $protocol $port 的占用"; return; fi
 ownership=$(printf '%s\n' "$docker_ports" | awk -F '\t' -v port="$port" -v protocol="$protocol" -v project=${q("sre-proxy-" + s.id)} '
 {
  count=split($2, mappings, ",")
  for (i=1; i<=count; i++) {
   mapping=mappings[i]; gsub(/^[ ]+|[ ]+$/, "", mapping)
   if (mapping !~ ("/" protocol "$")) continue
   if (split(mapping, sides, "->") != 2) continue
   binding=sides[1]; sub(/^.*:/, "", binding)
   if (binding !~ /^[0-9]+(-[0-9]+)?$/) continue
   bounds=split(binding, range, "-"); high=(bounds==2 ? range[2]+0 : range[1]+0)
   if (port+0 >= range[1]+0 && port+0 <= high) {
    if ($1==project) own=1; else other=1
   }
  }
 }
 END { if (other) print "other"; else if (own) print "own"; else print "none" }
 ')
 if test "$ownership" = other; then emit "$check_id" fail "$protocol $port 已被其他容器发布";
 elif test -n "$occupied" && test "$ownership" != own; then emit "$check_id" fail "$protocol $port 被其他服务占用";
 elif test "$ownership" = own; then emit "$check_id" pass "$protocol $port 由本应用占用，可更新";
 elif test "$docker_state" = stopped; then emit "$check_id" warn "$protocol $port 当前无监听，但 Docker daemon 不可用，启动后的容器端口占用仍需核实";
 else emit "$check_id" pass "$protocol $port 空闲"; fi
}
for port in ${ports.join(" ")}; do check_port "$port" tcp "port-$port"; done
${s.domain ? "check_port 443 udp port-443-udp" : ""}
${s.domain ? `if getent ahostsv4 ${q(s.domain)} >/dev/null 2>&1; then emit dns pass '域名已有 IPv4 解析，请另行核实公网指向与 80/443 可达性'; else emit dns fail '域名尚无 IPv4 解析，请配置 DNS'; fi` : "emit dns pass '未配置域名，使用 HTTP 端口'"}
${s.volumes.map((v, i) => `if test -d ${q(v.source)}; then emit volume-${i} pass ${q("挂载目录存在：" + v.source)}; else emit volume-${i} fail ${q("挂载源目录不存在：" + v.source)}; fi`).join("\n")}
if command -v getenforce >/dev/null 2>&1 && test "$(getenforce)" = Enforcing; then emit selinux warn 'SELinux 为 Enforcing；持久化目录需管理员准备兼容标签，不会自动重标记目录'; else emit selinux pass '未检测到 SELinux Enforcing'; fi
if command -v firewall-cmd >/dev/null 2>&1 && test "$(firewall-cmd --state 2>/dev/null)" = running; then emit firewall warn 'firewalld 正在运行，请核实应用端口及域名的 TCP 80/443、UDP 443 入站策略；Docker 发布端口可能绕过常规规则，工作台不会改动防火墙'; else emit firewall warn '未检测到运行中的 firewalld；仍需核实主机、云安全组与公网访问策略'; fi
printf 'SRE_PREFLIGHT_DONE\\n'
`;
}

export function parseDeploymentPreflight(
  output: string,
): DeploymentPreflightCheck[] {
  const checks = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SRE_CHECK\t"))
    .map((line) => {
      const [, id, status, ...detail] = line.split("\t");
      if (!id || !["pass", "warn", "fail"].includes(status))
        throw new Error("环境预检返回格式无效");
      return {
        id,
        status: status as DeploymentPreflightCheck["status"],
        detail: detail.join(" "),
      };
    });
  if (
    !output.split(/\r?\n/).includes("SRE_PREFLIGHT_DONE") ||
    ![
      "privilege",
      "platform",
      "systemd",
      "tools",
      "disk-/var",
      "disk-/opt",
      "disk-/tmp",
      "memory",
      "runtime-conflicts",
      "docker",
      "dns",
      "selinux",
    ].every((id) => checks.some((c) => c.id === id))
  )
    throw new Error("环境预检未完成，请重新检查");
  return checks;
}
