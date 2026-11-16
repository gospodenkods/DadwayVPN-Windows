param([switch]$Installer, [switch]$ScanOnly)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-VpnApplications {
    $roots = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    $pattern = '(?i)vpn|wireguard|openvpn|amnezia|outline|clash|nekoray|v2ray|sing-box|tun2socks|proxifier|psiphon|lantern|windscribe|proton|nordvpn|surfshark|expressvpn|adguard vpn|cloudflare warp|1\.1\.1\.1'
    Get-ItemProperty $roots | Where-Object {
        $_.DisplayName -and $_.UninstallString -and $_.DisplayName -match $pattern -and $_.DisplayName -notmatch '(?i)dadway|xray'
    } | Sort-Object DisplayName -Unique | ForEach-Object {
        [pscustomobject]@{ Kind='app'; Label="VPN-клиент: $($_.DisplayName)"; Path=$_.PSPath; Command=$_.UninstallString }
    }
}

function Get-ProxyExtensions {
    $browserRoots = @(
        @{ Name='Google Chrome'; Root=(Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data') },
        @{ Name='Microsoft Edge'; Root=(Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data') },
        @{ Name='Brave'; Root=(Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\User Data') }
    )
    foreach ($browser in $browserRoots) {
        if (-not (Test-Path -LiteralPath $browser.Root)) { continue }
        Get-ChildItem -LiteralPath $browser.Root -Directory | Where-Object { $_.Name -eq 'Default' -or $_.Name -match '^Profile \d+$' } | ForEach-Object {
            $profile = $_
            $extensionsRoot = Join-Path $profile.FullName 'Extensions'
            if (-not (Test-Path -LiteralPath $extensionsRoot)) { return }
            Get-ChildItem -LiteralPath $extensionsRoot -Directory | ForEach-Object {
                $extension = $_
                $manifest = Get-ChildItem -LiteralPath $extension.FullName -Filter manifest.json -Recurse -File | Sort-Object FullName -Descending | Select-Object -First 1
                if (-not $manifest) { return }
                $json = Get-Content -LiteralPath $manifest.FullName -Raw | ConvertFrom-Json
                $permissions = @($json.permissions) + @($json.optional_permissions)
                $looksLikeProxy = ($permissions -contains 'proxy') -or ($json.name -match '(?i)vpn|proxy|прокси|unblock|browsec|hola|zenmate|friGate|touch vpn')
                if ($looksLikeProxy) {
                    [pscustomobject]@{ Kind='extension'; Label="Расширение $($browser.Name): $($json.name) [$($extension.Name)]"; Path=$extension.FullName; Command=$browser.Name }
                }
            }
        }
    }
}

function Get-NetworkConflicts {
    $items = @()
    $proxy = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    if ($proxy.ProxyEnable -eq 1 -and $proxy.ProxyServer -and $proxy.ProxyServer -notmatch '127\.0\.0\.1:(10808|10809)') {
        $items += [pscustomobject]@{ Kind='proxy'; Label="Системный прокси Windows: $($proxy.ProxyServer)"; Path=''; Command='' }
    }
    Get-NetAdapter | Where-Object {
        $_.Status -eq 'Up' -and ($_.InterfaceDescription -match '(?i)wireguard|wintun|tap-windows|openvpn|vpn|tun' -or $_.Name -match '(?i)vpn|tun|tap') -and $_.InterfaceDescription -notmatch '(?i)dadway'
    } | ForEach-Object {
        $items += [pscustomobject]@{ Kind='adapter'; Label="Активный VPN-адаптер: $($_.Name) — $($_.InterfaceDescription)"; Path=$_.Name; Command='' }
    }
    $items
}

$conflicts = @((Get-VpnApplications)) + @((Get-ProxyExtensions)) + @((Get-NetworkConflicts))
if ($ScanOnly) { $conflicts | Select-Object Kind,Label,Path | ConvertTo-Json -Depth 3; exit 0 }
if ($conflicts.Count -eq 0) { exit 0 }

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Dadway VPN — проверка совместимости'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(720,540)
$form.MinimumSize = New-Object System.Drawing.Size(620,440)
$form.Font = New-Object System.Drawing.Font('Segoe UI',10)
$form.TopMost = $true

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Обнаружены программы и настройки, которые могут мешать режиму TUN'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold',13)
$title.AutoSize = $false; $title.Location = New-Object System.Drawing.Point(18,16); $title.Size = New-Object System.Drawing.Size(670,48)
$form.Controls.Add($title)

$description = New-Object System.Windows.Forms.Label
$description.Text = "Выберите только те элементы, которые хотите удалить или отключить. Ничего не удаляется автоматически. Закройте браузеры перед удалением расширений."
$description.AutoSize = $false; $description.Location = New-Object System.Drawing.Point(18,66); $description.Size = New-Object System.Drawing.Size(670,55)
$form.Controls.Add($description)

$list = New-Object System.Windows.Forms.CheckedListBox
$list.CheckOnClick = $true; $list.Location = New-Object System.Drawing.Point(18,125); $list.Size = New-Object System.Drawing.Size(670,270); $list.Anchor = 'Top,Bottom,Left,Right'
foreach ($item in $conflicts) { [void]$list.Items.Add($item.Label, $false) }
$form.Controls.Add($list)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Не отмечайте рабочий корпоративный VPN, если он вам необходим.'; $status.AutoSize = $false; $status.Location = New-Object System.Drawing.Point(18,404); $status.Size = New-Object System.Drawing.Size(670,35); $status.Anchor='Bottom,Left,Right'
$form.Controls.Add($status)

$remove = New-Object System.Windows.Forms.Button
$remove.Text = 'Удалить выбранное и продолжить'; $remove.Size = New-Object System.Drawing.Size(235,38); $remove.Location = New-Object System.Drawing.Point(18,448); $remove.Anchor='Bottom,Left'
$continue = New-Object System.Windows.Forms.Button
$continue.Text = 'Продолжить без удаления'; $continue.Size = New-Object System.Drawing.Size(220,38); $continue.Location = New-Object System.Drawing.Point(263,448); $continue.Anchor='Bottom,Left'
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Отмена установки'; $cancel.Size = New-Object System.Drawing.Size(195,38); $cancel.Location = New-Object System.Drawing.Point(493,448); $cancel.Anchor='Bottom,Right'
$form.Controls.AddRange(@($remove,$continue,$cancel))

$remove.Add_Click({
    $selected = @($list.CheckedIndices)
    if ($selected.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('Сначала отметьте элементы или выберите «Продолжить без удаления».','Dadway VPN') | Out-Null; return }
    $failures = @()
    foreach ($index in $selected) {
        $item = $conflicts[[int]$index]
        try {
            switch ($item.Kind) {
                'app' { Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/c',$item.Command) -Wait }
                'extension' {
                    $knownRoot = @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),(Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'),(Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\User Data')) | Where-Object { $item.Path.StartsWith($_,[System.StringComparison]::OrdinalIgnoreCase) }
                    if (-not $knownRoot) { throw 'Недопустимый путь расширения' }
                    Remove-Item -LiteralPath $item.Path -Recurse -Force -ErrorAction Stop
                }
                'proxy' {
                    Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name ProxyEnable -Type DWord -Value 0
                    Start-Process -FilePath 'netsh.exe' -ArgumentList @('winhttp','reset','proxy') -WindowStyle Hidden -Wait
                }
                'adapter' { Disable-NetAdapter -Name $item.Path -Confirm:$false -ErrorAction Stop }
            }
        } catch { $failures += $item.Label }
    }
    if ($failures.Count) { [System.Windows.Forms.MessageBox]::Show("Не удалось обработать:`r`n" + ($failures -join "`r`n") + "`r`n`r`nЗакройте соответствующие программы и повторите удаление вручную.",'Dadway VPN') | Out-Null }
    $form.Tag = 0; $form.Close()
})
$continue.Add_Click({ $form.Tag = 0; $form.Close() })
$cancel.Add_Click({ $form.Tag = 2; $form.Close() })
$form.Add_FormClosing({ if ($null -eq $form.Tag) { $form.Tag = 2 } })
[void]$form.ShowDialog()
exit [int]$form.Tag
