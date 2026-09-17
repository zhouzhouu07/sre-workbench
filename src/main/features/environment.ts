/** Run only inside a user-confirmed remote task as root. */
export const installDocker = `set -euo pipefail
. /etc/os-release
case "$ID:$VERSION_ID:$(uname -m)" in ubuntu:22.04:x86_64|ubuntu:24.04:x86_64|debian:12:x86_64) ;; *) echo '仅支持 Ubuntu 22.04/24.04、Debian 12 x86_64'; exit 1;; esac
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
systemctl start docker
docker info >/dev/null
docker compose version
`;
export const environmentPreflight = `set -eu
. /etc/os-release
case "$ID:$VERSION_ID:$(uname -m)" in ubuntu:22.04:x86_64|ubuntu:24.04:x86_64|debian:12:x86_64) ;; *) echo '仅支持 Ubuntu 22.04/24.04、Debian 12 x86_64' >&2; exit 1;; esac
command -v systemd-run >/dev/null
test "$(ps -p 1 -o comm= | tr -d ' ')" = systemd
available=$(df -Pk /var | awk 'NR==2 {print $4}')
test "$available" -ge 2097152 || { echo '/var 至少需要 2 GiB 可用空间' >&2; exit 1; }
printf 'OS=%s %s; ARCH=%s; available=%s KiB\\n' "$ID" "$VERSION_ID" "$(uname -m)" "$available"
`;
