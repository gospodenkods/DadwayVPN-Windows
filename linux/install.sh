#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Dadway VPN"
APP_DIR="/opt/dadway-vpn"
BIN_PATH="/usr/local/bin/dadway-vpn"
DESKTOP_PATH="/usr/share/applications/dadway-vpn.desktop"
DATA_DIR="/usr/local/share/dadway-vpn"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

info()  { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
fatal() { printf '\033[1;31m[ERR ]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR:-}" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT
trap 'fatal "Ошибка в строке ${LINENO}. Установка остановлена."' ERR

[[ ${EUID} -eq 0 ]] || fatal "Запустите установщик через sudo: sudo bash $0"
command -v apt-get >/dev/null 2>&1 || fatal "Поддерживаются Debian, Ubuntu и Q4OS с пакетным менеджером APT."

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO="${PRETTY_NAME:-${ID:-Linux}}"
else
  DISTRO="Linux"
fi
info "Обнаружена система: ${DISTRO}"

SOURCE_DIR="$SCRIPT_DIR"
if [[ ! -d "$SOURCE_DIR/dadwayvpn" ]]; then
  for candidate in "$SCRIPT_DIR/DadwayVPN-Linux" "$PWD" "$PWD/DadwayVPN-Linux"; do
    if [[ -d "$candidate/dadwayvpn" ]]; then
      SOURCE_DIR="$candidate"
      break
    fi
  done
fi
[[ -f "$SOURCE_DIR/dadwayvpn/__main__.py" ]] || fatal "Не найдена папка dadwayvpn. Поместите скрипт в корень распакованного проекта."

export DEBIAN_FRONTEND=noninteractive
info "Обновление списка пакетов..."
apt-get update

PACKAGES=(
  python3
  python3-gi
  gir1.2-gtk-3.0
  curl
  unzip
  ca-certificates
  desktop-file-utils
  libgtk-3-0
  libglib2.0-bin
)

# Индикатор в трее отличается между версиями Debian/Ubuntu.
if apt-cache show libayatana-appindicator3-1 >/dev/null 2>&1; then
  PACKAGES+=(libayatana-appindicator3-1)
elif apt-cache show libappindicator3-1 >/dev/null 2>&1; then
  PACKAGES+=(libappindicator3-1)
fi

info "Установка системных зависимостей..."
apt-get install -y --no-install-recommends "${PACKAGES[@]}"

info "Установка файлов приложения..."
rm -rf -- "$APP_DIR"
install -d -m 0755 "$APP_DIR" "$DATA_DIR" /usr/local/bin /usr/share/applications
cp -a "$SOURCE_DIR/dadwayvpn" "$APP_DIR/"

cat > "$BIN_PATH" <<'LAUNCHER'
#!/bin/sh
cd /opt/dadway-vpn || exit 1
exec python3 -m dadwayvpn "$@"
LAUNCHER
chmod 0755 "$BIN_PATH"

cat > "$DESKTOP_PATH" <<'DESKTOP'
[Desktop Entry]
Name=Dadway VPN
Name[ru]=Dadway VPN
Comment=VPN-клиент Dadway для Linux
Comment[ru]=VPN-клиент Dadway для Linux
Exec=/usr/local/bin/dadway-vpn
Icon=network-vpn
Terminal=false
Type=Application
Categories=Network;Security;
Keywords=VPN;Xray;VLESS;Proxy;
StartupNotify=true
DESKTOP
chmod 0644 "$DESKTOP_PATH"

case "$(dpkg --print-architecture)" in
  amd64) XRAY_ARCH="64" ;;
  arm64) XRAY_ARCH="arm64-v8a" ;;
  armhf) XRAY_ARCH="arm32-v7a" ;;
  *) fatal "Архитектура $(dpkg --print-architecture) пока не поддерживается Xray-установщиком." ;;
esac

TMP_DIR="$(mktemp -d -t dadway-vpn.XXXXXXXX)"
XRAY_ZIP="$TMP_DIR/xray.zip"
XRAY_DIR="$TMP_DIR/xray"
mkdir -p "$XRAY_DIR"
XRAY_URL="https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${XRAY_ARCH}.zip"

info "Загрузка Xray Core для архитектуры ${XRAY_ARCH}..."
curl --fail --location --retry 3 --connect-timeout 20 --progress-bar "$XRAY_URL" -o "$XRAY_ZIP"
unzip -q "$XRAY_ZIP" -d "$XRAY_DIR"
[[ -x "$XRAY_DIR/xray" || -f "$XRAY_DIR/xray" ]] || fatal "В архиве Xray не найден исполняемый файл."

install -m 0755 "$XRAY_DIR/xray" /usr/local/bin/xray
for asset in geoip.dat geosite.dat; do
  if [[ -f "$XRAY_DIR/$asset" ]]; then
    install -m 0644 "$XRAY_DIR/$asset" "$DATA_DIR/$asset"
    ln -sfn "$DATA_DIR/$asset" "/usr/local/bin/$asset"
  else
    warn "$asset отсутствует в архиве Xray."
  fi
done

update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
glib-compile-schemas /usr/share/glib-2.0/schemas >/dev/null 2>&1 || true

# Проверка Python/GTK и Xray до завершения установки.
info "Проверка компонентов..."
python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' 
/usr/local/bin/xray version | head -n 1

ok "$APP_NAME установлен."
printf '\nЗапуск из терминала:\n  dadway-vpn\n\n'
printf 'Также приложение доступно в меню: Интернет → Dadway VPN.\n'
printf 'Удаление:\n  sudo rm -rf %q %q %q %q /usr/local/bin/xray\n' "$APP_DIR" "$DATA_DIR" "$BIN_PATH" "$DESKTOP_PATH"
