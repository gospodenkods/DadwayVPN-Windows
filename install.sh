#!/bin/bash
set -euo pipefail
[ "${EUID}" -eq 0 ] || { echo "Запустите: sudo ./install.sh"; exit 1; }
apt-get update
apt-get install -y python3 python3-gi gir1.2-gtk-3.0 curl unzip ca-certificates libayatana-appindicator3-1 || true
install -d /opt/dadway-vpn /usr/local/bin /usr/share/applications /usr/local/share/dadway-vpn
cp -r dadwayvpn /opt/dadway-vpn/
cp dadway-vpn.desktop /usr/share/applications/
cat >/usr/local/bin/dadway-vpn <<'RUN'
#!/bin/sh
cd /opt/dadway-vpn
exec python3 -m dadwayvpn "$@"
RUN
chmod +x /usr/local/bin/dadway-vpn
ARCH=$(dpkg --print-architecture)
case "$ARCH" in amd64) XRAY_ARCH=64;; arm64) XRAY_ARCH=arm64-v8a;; *) echo "Архитектура $ARCH пока не поддерживается"; exit 1;; esac
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
curl -fL "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${XRAY_ARCH}.zip" -o "$TMP/xray.zip"
unzip -q "$TMP/xray.zip" -d "$TMP/xray"
install -m 0755 "$TMP/xray/xray" /usr/local/bin/xray
install -m 0644 "$TMP/xray/geoip.dat" /usr/local/share/dadway-vpn/geoip.dat
install -m 0644 "$TMP/xray/geosite.dat" /usr/local/share/dadway-vpn/geosite.dat
ln -sf /usr/local/share/dadway-vpn/geoip.dat /usr/local/bin/geoip.dat
ln -sf /usr/local/share/dadway-vpn/geosite.dat /usr/local/bin/geosite.dat
update-desktop-database >/dev/null 2>&1 || true
echo "Готово. Запуск: dadway-vpn"
