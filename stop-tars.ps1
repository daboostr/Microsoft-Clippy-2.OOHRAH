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

# 3. Pause the Voice Handoff Queue automation. TARS is the only thing that can write
# a queue item (via delegate) -- with TARS down there is never anything to process,
# so leave a flag the automation checks first and no-ops on, instead of actually
# disabling the automation (which cannot reliably re-enable itself later -- nothing
# would be left running to notice "TARS is back"). launch-tars.ps1 clears this flag.
$flag = Join-Path $env:USERPROFILE '.copilot\handoff\tars-down.flag'
New-Item -ItemType Directory -Force -Path (Split-Path $flag) | Out-Null
Set-Content -Path $flag -Value (Get-Date).ToString('o') -Encoding UTF8
