# Hermes 桌面端中文界面 — one-line installer (Windows PowerShell)
#
#   irm https://raw.githubusercontent.com/yehaicheng258-arch/hermes-desktop-zh-ui/main/install.ps1 | iex
#
# Copies dist/plugin.js into <HERMES_HOME>\desktop-plugins\zh-ui\plugin.js.
# The app watches that folder and hot-loads the plugin within a few seconds.
param([string]$Ref = 'main')

$ErrorActionPreference = 'Stop'

$root = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $HOME '.hermes' }
if (-not (Test-Path $root)) {
    Write-Error "Hermes data dir not found: $root. Set `$env:HERMES_HOME to your Hermes home and retry."
    exit 1
}

$dir = Join-Path $root 'desktop-plugins\zh-ui'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$url = "https://raw.githubusercontent.com/yehaicheng258-arch/hermes-desktop-zh-ui/$Ref/dist/plugin.js"
$dest = Join-Path $dir 'plugin.js'
Write-Host "downloading $url"
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

$size = (Get-Item $dest).Length
Write-Host ("installed -> {0} ({1:N0} bytes)" -f $dest, $size)
Write-Host 'Switch to the Hermes window: a "中" chip appears in the status bar (a few seconds).'
Write-Host 'If you use a named profile, the folder is <HERMES_HOME>\profiles\<name>\desktop-plugins\zh-ui\ instead.'
