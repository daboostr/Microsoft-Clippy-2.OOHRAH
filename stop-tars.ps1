# Stop TARS Voice — shuts down the bridge and the orb app.
# Precisely targets ONLY TARS's own processes (the scout-voice electron binary and
# the bridge.mjs node process) so it never touches other Electron apps on the system.
$ErrorActionPreference = 'SilentlyContinue'

# 1. Stop the bridge (node running bridge/bridge.mjs under scout-voice).
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'bridge\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 2. Stop the orb app — only electron.exe launched from this scout-voice folder.
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -match 'scout-voice' -or $_.ExecutablePath -match 'scout-voice' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
