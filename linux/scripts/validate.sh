#!/usr/bin/env bash
set -Eeuo pipefail
python3 -m compileall -q dadwayvpn
bash -n install.sh build-deb.sh scripts/build-portable.sh
python3 - <<'PY'
from pathlib import Path
required = [
    Path('dadwayvpn/__main__.py'),
    Path('dadwayvpn/app.py'),
    Path('dadway-vpn.desktop'),
    Path('install.sh'),
]
missing = [str(p) for p in required if not p.is_file()]
if missing:
    raise SystemExit('Missing required files: ' + ', '.join(missing))
PY
