#!/bin/bash
set -eu
python3 - <<'PY'
import json, os, urllib.request, urllib.error
port = json.loads(os.environ['SRE_TOOL_INPUT'])['port']
assert type(port) is int and 1024 <= port <= 65535
try:
    with urllib.request.urlopen('http://127.0.0.1:%d/' % port, timeout=5) as response:
        status = response.status
        response.read(65536)
        result = dict(healthy=status == 200, status=status, detail='HTTP response observed')
except urllib.error.HTTPError as error:
    result = dict(healthy=False, status=error.code, detail='HTTP error observed')
except Exception as error:
    result = dict(healthy=False, status=0, detail=type(error).__name__)
print(json.dumps(result))
PY
