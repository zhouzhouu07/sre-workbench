import { stringify } from "yaml";
import type { DeploymentSpec } from "../../shared/types";
import { shellQuote as q } from "../core/safety";

export const deploymentBase = (id: string) =>
  "/opt/sre-workbench/deployments/" + id;
const runtime = (s: DeploymentSpec) =>
  s.template === "python"
    ? s.runtime === "3.11" || s.runtime === "3.11.11"
      ? "3.11.11"
      : "3.12.9"
    : s.runtime === "20" || s.runtime === "20.19.0"
      ? "20.19.0"
      : "22.14.0";
const run = (command: string) =>
  command ? `RUN ${JSON.stringify(["/bin/sh", "-c", command])}\n` : "";
export function deploymentFiles(
  s: DeploymentSpec,
  releaseId: string,
): Record<string, string> {
  const base = deploymentBase(s.id),
    release = base + "/releases/" + releaseId,
    image = "sre-" + s.id + ":" + releaseId,
    network = "sre-" + s.id;
  let dockerfile = "";
  if (s.template === "node" || s.template === "static")
    dockerfile = `FROM node:${runtime(s)}-bookworm-slim${s.template === "static" ? " AS build" : ""}\nWORKDIR /app\nCOPY . .\n${run(s.installCommand)}${run(s.buildCommand)}`;
  if (s.template === "node")
    dockerfile += `ENV NODE_ENV=production\nEXPOSE ${s.containerPort}\nCMD ${JSON.stringify(["/bin/sh", "-c", s.startCommand])}\n`;
  if (s.template === "python")
    dockerfile = `FROM python:${runtime(s)}-slim-bookworm\nWORKDIR /app\nCOPY . .\n${run(s.installCommand)}${run(s.buildCommand)}EXPOSE ${s.containerPort}\nCMD ${JSON.stringify(["/bin/sh", "-c", s.startCommand])}\n`;
  if (s.template === "static")
    dockerfile += `FROM nginx:1.27.5-alpine\nCOPY --from=build /app/${s.outputDir} /usr/share/nginx/html\nCOPY sre-nginx.conf /etc/nginx/conf.d/default.conf\nEXPOSE ${s.containerPort}\n`;
  const compose = {
    name: "sre-" + releaseId,
    services: {
      app: {
        image,
        build: {
          context: release + "/source",
          dockerfile:
            s.template === "dockerfile" ? "Dockerfile" : "SRE.Dockerfile",
        },
        restart: "unless-stopped",
        environment: Object.fromEntries(
          Object.entries(s.env).map(([k, v]) => [k, v.replace(/\$/g, "$$$$")]),
        ),
        ports: [`127.0.0.1::${s.containerPort}`],
        volumes: s.volumes.map((v) => ({
          type: "bind",
          source: v.source,
          target: v.target,
          bind: { create_host_path: false },
        })),
        networks: { app: { aliases: ["app-" + releaseId] } },
      },
    },
    networks: { app: { external: true, name: network } },
  };
  const proxy = {
    name: "sre-proxy-" + s.id,
    services: {
      caddy: {
        image: "caddy:2.9.1-alpine",
        restart: "unless-stopped",
        ports: s.domain
          ? ["80:80", "443:443", "443:443/udp"]
          : [`${s.publicPort}:80`],
        volumes: [
          base + "/routing:/etc/caddy:ro",
          "caddy-data:/data",
          "caddy-config:/config",
        ],
        networks: ["app"],
      },
    },
    networks: { app: { external: true, name: network } },
    volumes: { "caddy-data": {}, "caddy-config": {} },
  };
  const route = `${s.domain || ":80"} {\n  reverse_proxy app-${releaseId}:${s.containerPort}\n}\n`;
  return {
    "compose.yml": stringify(compose),
    "proxy.yml": stringify(proxy),
    Caddyfile: route,
    ...(dockerfile ? { "source/SRE.Dockerfile": dockerfile } : {}),
    ...(s.template === "static"
      ? {
          "source/sre-nginx.conf": `server { listen ${s.containerPort}; root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html; } }\n`,
        }
      : {}),
  };
}
/** The active routing file is touched only after the candidate responds successfully. */
export function deploymentScript(
  s: DeploymentSpec,
  releaseId: string,
  stage: string,
  rollback = false,
): string {
  const base = deploymentBase(s.id),
    release = base + "/releases/" + releaseId,
    network = "sre-" + s.id;
  return `set -euo pipefail
umask 077
base=${q(base)}
release=${q(release)}
mkdir -p "$base/releases" "$base/routing"
old=$(cat "$base/current" 2>/dev/null || true)
if test -n "$old"; then [[ "$old" =~ ^[0-9a-f-]{36}$ ]] || exit 1; fi
old_stopped=0
route_changed=0
finished=0
recover() {
  code=$?
  if test "$finished" = 0; then
    if test "$route_changed" = 1; then
      if test -f "$base/routing/previous"; then cp "$base/routing/previous" "$base/routing/Caddyfile"; fi
      if test -f "$base/proxy.previous.yml"; then
        cp "$base/proxy.previous.yml" "$base/proxy.yml"
        docker compose -f "$base/proxy.yml" up -d || true
        docker compose -f "$base/proxy.yml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
      fi
    fi
    if test "$old" != ${q(releaseId)} && test -f "$release/compose.yml"; then docker compose -f "$release/compose.yml" stop || true; fi
    if test "$old_stopped" = 1; then docker compose -f "$base/releases/$old/compose.yml" up -d || true; fi
    echo 'Deployment failed; previous configuration recovery attempted. Check task logs.'
  fi
  exit "$code"
}
trap recover EXIT
docker network inspect ${q(network)} >/dev/null 2>&1 || docker network create ${q(network)} >/dev/null
${rollback ? 'test -f "$release/success"\ntest -f "$release/compose.yml"' : `test ! -e "$release"\nmkdir -m 700 "$release"\ncp -a -- ${q(stage + "/.")} "$release/"\nfind "$release/source" -type d -exec chmod 755 {} +\nfind "$release/source" -type f -exec chmod a+r {} +\ndocker compose -f "$release/compose.yml" build`}
${s.volumes.length ? `if test -n "$old" && test "$old" != ${q(releaseId)}; then docker compose -f "$base/releases/$old/compose.yml" stop; old_stopped=1; fi` : "# Stateless candidate may run alongside the previous release."}
docker compose -f "$release/compose.yml" up -d
port=$(docker compose -f "$release/compose.yml" port app ${s.containerPort} | tail -n 1 | sed 's/.*://')
test -n "$port"
healthy=0
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$port"${q(s.healthPath)} >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1 || { echo 'Candidate health check failed'; exit 1; }
docker run --rm -v "$release:/etc/caddy:ro" caddy:2.9.1-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
if test -f "$base/routing/Caddyfile"; then cp "$base/routing/Caddyfile" "$base/routing/previous"; fi
if test -f "$base/proxy.yml"; then cp "$base/proxy.yml" "$base/proxy.previous.yml"; fi
cp "$release/Caddyfile" "$base/routing/candidate"
cp "$release/proxy.yml" "$base/proxy.yml"
chmod 644 "$base/routing/candidate"
route_changed=1
mv "$base/routing/candidate" "$base/routing/Caddyfile"
docker compose -f "$base/proxy.yml" up -d
loaded=0
for attempt in $(seq 1 20); do
 if docker compose -f "$base/proxy.yml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then loaded=1; break; fi
 sleep 1
done
test "$loaded" = 1
printf %s ${q(releaseId)} > "$base/current.tmp"
mv "$base/current.tmp" "$base/current"
date -u +%FT%TZ > "$release/success"
finished=1
if test -n "$old" && test "$old" != ${q(releaseId)}; then docker compose -f "$base/releases/$old/compose.yml" stop || echo 'Previous release needs manual stop'; fi
{ printf '%s\\n' ${q(releaseId)}; find "$base/releases" -mindepth 2 -maxdepth 2 -name success -printf '%T@ %h\\n' | sort -rn | awk '{n=split($2,a,"/"); print a[n]}' | grep -v -F -x ${q(releaseId)} || true; } > "$base/order"
tail -n +4 "$base/order" | while IFS= read -r obsolete; do
 [[ "$obsolete" =~ ^[0-9a-f-]{36}$ ]] || exit 1
 test "$obsolete" != ${q(releaseId)}
 docker compose -f "$base/releases/$obsolete/compose.yml" down --remove-orphans
 docker image rm ${q("sre-" + s.id + ":")}"$obsolete" || true
 rm -rf -- "$base/releases/$obsolete"
done
printf 'SRE_RELEASE_SUCCESS=%s\\n' ${q(releaseId)}
`;
}
