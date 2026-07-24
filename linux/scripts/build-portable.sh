#!/usr/bin/env bash
set -Eeuo pipefail
VERSION="${VERSION:-1.0.0}"
ARCH="${ARCH:-$(uname -m)}"
DIST_DIR="${DIST_DIR:-dist}"
ROOT="build/portable/DadwayVPN-Linux-${VERSION}-${ARCH}"
rm -rf build/portable
mkdir -p "$ROOT" "$DIST_DIR"
cp -a dadwayvpn "$ROOT/"
cp -a dadway-vpn dadway-vpn.desktop install.sh README.md "$ROOT/"
cat > "$ROOT/run.sh" <<'RUN'
#!/bin/sh
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$HERE" || exit 1
exec python3 -m dadwayvpn "$@"
RUN
chmod +x "$ROOT/run.sh" "$ROOT/install.sh" "$ROOT/dadway-vpn"
tar -C "$(dirname "$ROOT")" -czf "$DIST_DIR/DadwayVPN-Linux-${VERSION}-${ARCH}.tar.gz" "$(basename "$ROOT")"
sha256sum "$DIST_DIR/DadwayVPN-Linux-${VERSION}-${ARCH}.tar.gz" > "$DIST_DIR/DadwayVPN-Linux-${VERSION}-${ARCH}.tar.gz.sha256"
