#!/bin/bash
set -euo pipefail
VER=1.0.0
ARCH=all
PKG="build/dadway-vpn_${VER}_${ARCH}"
rm -rf build; mkdir -p "$PKG/DEBIAN" "$PKG/opt/dadway-vpn" "$PKG/usr/local/bin" "$PKG/usr/share/applications"
cp -r dadwayvpn "$PKG/opt/dadway-vpn/"
cp dadway-vpn.desktop "$PKG/usr/share/applications/"
cat >"$PKG/usr/local/bin/dadway-vpn" <<'RUN'
#!/bin/sh
cd /opt/dadway-vpn
exec python3 -m dadwayvpn "$@"
RUN
chmod +x "$PKG/usr/local/bin/dadway-vpn"
cat >"$PKG/DEBIAN/control" <<CTRL
Package: dadway-vpn
Version: $VER
Section: net
Priority: optional
Architecture: $ARCH
Depends: python3, python3-gi, gir1.2-gtk-3.0, curl, unzip, ca-certificates
Maintainer: Dadway <gospodenkods@mail.ru>
Description: Dadway VPN GUI client for Debian, Ubuntu and Q4OS
CTRL

cat >"$PKG/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
if ! command -v xray >/dev/null 2>&1; then
  ARCH=$(dpkg --print-architecture)
  case "$ARCH" in amd64) XA=64;; arm64) XA=arm64-v8a;; *) exit 0;; esac
  TMP=$(mktemp -d)
  curl -fL "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${XA}.zip" -o "$TMP/x.zip"
  unzip -q "$TMP/x.zip" -d "$TMP/x"
  install -m 0755 "$TMP/x/xray" /usr/local/bin/xray
  install -d /usr/local/share/dadway-vpn
  install -m 0644 "$TMP/x/geoip.dat" /usr/local/share/dadway-vpn/geoip.dat
  install -m 0644 "$TMP/x/geosite.dat" /usr/local/share/dadway-vpn/geosite.dat
  rm -rf "$TMP"
fi
exit 0
POST
chmod 0755 "$PKG/DEBIAN/postinst"
dpkg-deb --build "$PKG"
