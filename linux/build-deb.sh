#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="${VERSION:-1.0.0}"
DEB_ARCH="${DEB_ARCH:-$(dpkg --print-architecture)}"
DIST_DIR="${DIST_DIR:-dist}"
XRAY_CACHE_DIR="${XRAY_CACHE_DIR:-.cache/xray-${DEB_ARCH}}"
PKG_ROOT="build/dadway-vpn_${VERSION}_${DEB_ARCH}"
OUTPUT="${DIST_DIR}/dadway-vpn_${VERSION}_${DEB_ARCH}.deb"

case "$DEB_ARCH" in
  amd64) XRAY_ARCH="64" ;;
  arm64) XRAY_ARCH="arm64-v8a" ;;
  armhf) XRAY_ARCH="arm32-v7a" ;;
  *) echo "Unsupported Debian architecture: $DEB_ARCH" >&2; exit 2 ;;
esac

command -v dpkg-deb >/dev/null || { echo "dpkg-deb is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v unzip >/dev/null || { echo "unzip is required" >&2; exit 1; }

rm -rf build
mkdir -p \
  "$PKG_ROOT/DEBIAN" \
  "$PKG_ROOT/opt/dadway-vpn/dadwayvpn" \
  "$PKG_ROOT/usr/local/bin" \
  "$PKG_ROOT/usr/local/share/dadway-vpn" \
  "$PKG_ROOT/usr/share/applications" \
  "$DIST_DIR" \
  "$XRAY_CACHE_DIR"

cp -a dadwayvpn/. "$PKG_ROOT/opt/dadway-vpn/dadwayvpn/"
install -m 0644 dadway-vpn.desktop "$PKG_ROOT/usr/share/applications/dadway-vpn.desktop"

cat > "$PKG_ROOT/usr/local/bin/dadway-vpn" <<'RUN'
#!/bin/sh
cd /opt/dadway-vpn || exit 1
exec python3 -m dadwayvpn "$@"
RUN
chmod 0755 "$PKG_ROOT/usr/local/bin/dadway-vpn"

XRAY_ZIP="$XRAY_CACHE_DIR/xray.zip"
XRAY_UNPACK="$XRAY_CACHE_DIR/unpacked"
if [[ ! -x "$XRAY_UNPACK/xray" ]]; then
  rm -rf "$XRAY_UNPACK"
  mkdir -p "$XRAY_UNPACK"
  curl --fail --location --retry 3 --connect-timeout 20 \
    "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${XRAY_ARCH}.zip" \
    -o "$XRAY_ZIP"
  unzip -q -o "$XRAY_ZIP" -d "$XRAY_UNPACK"
fi

install -m 0755 "$XRAY_UNPACK/xray" "$PKG_ROOT/usr/local/bin/xray"
install -m 0644 "$XRAY_UNPACK/geoip.dat" "$PKG_ROOT/usr/local/share/dadway-vpn/geoip.dat"
install -m 0644 "$XRAY_UNPACK/geosite.dat" "$PKG_ROOT/usr/local/share/dadway-vpn/geosite.dat"

cat > "$PKG_ROOT/DEBIAN/control" <<CTRL
Package: dadway-vpn
Version: ${VERSION}
Section: net
Priority: optional
Architecture: ${DEB_ARCH}
Depends: python3, python3-gi, gir1.2-gtk-3.0, libgtk-3-0, ca-certificates, curl
Recommends: libayatana-appindicator3-1 | libappindicator3-1
Maintainer: Dadway <gospodenkods@mail.ru>
Homepage: https://github.com/gospodenkods/DadwayVPN-Windows
Description: Dadway VPN GUI client for Debian, Ubuntu and Q4OS
 GTK 3 client with bundled Xray Core, subscription support and
 local HTTP/SOCKS proxy management.
CTRL

cat > "$PKG_ROOT/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
ln -sfn /usr/local/share/dadway-vpn/geoip.dat /usr/local/bin/geoip.dat
ln -sfn /usr/local/share/dadway-vpn/geosite.dat /usr/local/bin/geosite.dat
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications || true
exit 0
POST
chmod 0755 "$PKG_ROOT/DEBIAN/postinst"

cat > "$PKG_ROOT/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e
rm -f /usr/local/bin/geoip.dat /usr/local/bin/geosite.dat
exit 0
PRERM
chmod 0755 "$PKG_ROOT/DEBIAN/prerm"

cat > "$PKG_ROOT/DEBIAN/conffiles" <<'CONF'
CONF

dpkg-deb --root-owner-group --build "$PKG_ROOT" "$OUTPUT"
dpkg-deb --info "$OUTPUT"
echo "Built: $OUTPUT"
