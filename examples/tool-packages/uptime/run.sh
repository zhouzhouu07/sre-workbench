#!/bin/bash
set -e
value=$(cut -d ' ' -f 1 /proc/uptime)
printf '{"uptimeSeconds":%s}\n' "$value"
