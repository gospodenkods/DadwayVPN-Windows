!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\installer-conflict-check.ps1 "${BUILD_RESOURCES_DIR}\installer-conflict-check.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-conflict-check.ps1" -Installer' $0
  ${If} $0 == 2
    MessageBox MB_ICONINFORMATION|MB_OK "Установка Dadway VPN отменена пользователем."
    Abort
  ${EndIf}
!macroend
