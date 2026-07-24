# Dadway VPN for Windows 10

Нативный клиент WPF/.NET 8 для Windows 10 x64 с Xray Core и фирменным интерфейсом Dadway VPN.

## Реализовано

- три профиля: Россия, USA, Netherlands;
- загрузка и кэширование подписок;
- VLESS + WS/TLS и XHTTP/REALITY;
- системный HTTP/HTTPS-прокси Windows;
- исключение доменов `.ru`, `.by`, `.su` из проксирования;
- загрузка официального Xray Core при первом запуске;
- выбор сервера тремя карточками в одной линии;
- трей, автозапуск, журнал, внешний IP и ping;
- portable-сборка и MSI через GitHub Actions.

## Важно

Версия 1.0 использует системный прокси Windows. Полноценный TUN/Wintun и строгий Kill Switch заложены как следующий этап: они требуют отдельной Windows-службы с повышенными правами и драйвера. Интерфейс содержит настройку Kill Switch в модели, но сетевой фильтр в этой версии не активируется.

## Локальная сборка

```powershell
dotnet publish src\DadwayVPN.Windows\DadwayVPN.Windows.csproj -c Release -r win-x64 --self-contained true -o publish
```

## GitHub Actions

После push откройте **Actions → Build Dadway VPN Windows**. Артефакт содержит portable ZIP и MSI.
