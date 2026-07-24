# Загрузка в GitHub

```powershell
cd D:\git\DadwayVPN-Windows
powershell.exe -ExecutionPolicy Bypass -File .\scripts\upload-to-github.ps1 -RepositoryUrl "https://github.com/gospodenkods/DadwayVPN-Windows.git"
```

Если репозиторий уже существует, сначала клонируйте его и копируйте файлы поверх, сохраняя `.git`, затем:

```powershell
git add --all
git commit -m "Dadway VPN Windows 1.0.0"
git push origin main
```
