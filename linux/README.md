# Dadway VPN Linux 1.0

Нативный GUI-клиент для Q4OS, Ubuntu и Debian, перенесённый по возможностям из DadwayVPN-Windows.

## Возможности
- GUI на GTK 3 без Electron;
- серверы Россия, USA, Netherlands;
- загрузка подписок 3x-ui;
- запуск Xray Core;
- локальные HTTP и SOCKS5 прокси;
- системный proxy через `gsettings` для GNOME/Cinnamon и переменные окружения;
- внешний IP, ping, длительность сессии;
- автопереподключение и fallback Россия → USA;
- трей, автозапуск, журнал;
- установка `.deb` на Debian 12/13, Ubuntu 22.04/24.04, Q4OS 5/6.

## Быстрая установка
```bash
chmod +x install.sh
sudo ./install.sh
```

Запуск:
```bash
dadway-vpn
```

## Важно
Версия 1.0 использует системный HTTP/SOCKS proxy. Полный TUN потребует отдельного root-helper и настройки маршрутизации.

## GitHub Actions

Workflow `.github/workflows/linux-build.yml` запускается при push и pull request в ветки
`main`, `linux`, `dev`, а также вручную. Он проверяет Python и shell-скрипты, собирает
`.deb` для `amd64` и `arm64`, создаёт portable-архив и публикует GitHub Release при
создании тега вида `v1.0.0`.

Создание релиза:

```bash
git tag v1.0.0
git push origin v1.0.0
```
