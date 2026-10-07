# TARS Voice launcher — starts the orb app and the bridge, idempotently.
# Safe to run after a reboot or if TARS exited. Double-launch guarded.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# Ensure Microsoft Scout (the main agent that executes voice hand-offs) is running.
# Without it, delegated commands queue up but nothing works them.
if (-not (Get-CimInstance Win32_Process -Filter "Name='scout.exe'")) {
  $scoutExe = Join-Path $env:LOCALAPPDATA 'Programs\Clawpilot\Microsoft Scout\scout.exe'
  if (Test-Path $scoutExe) { Start-Process -FilePath $scoutExe }
}

# Point Azure CLI at the configured subscription so AAD tokens (chat + speech) resolve.
# Reads AZURE_SUBSCRIPTION_ID / AZURE_TENANT_ID from .env (gitignored). If not signed
# in, opens an interactive login to that tenant.
$sub = $null; $tenant = $null
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*AZURE_SUBSCRIPTION_ID\s*=\s*(.+)$') { $sub = $Matches[1].Trim() }
    if ($line -match '^\s*AZURE_TENANT_ID\s*=\s*(.+)$') { $tenant = $Matches[1].Trim() }
  }
}
if ($sub) { az account set --subscription $sub 2>$null }
$acct = az account show --query id -o tsv 2>$null
if (-not $acct) {
  $loginArgs = if ($tenant) { "login --tenant $tenant" } else { "login" }
  Start-Process -FilePath 'az' -ArgumentList $loginArgs -Wait
  if ($sub) { az account set --subscription $sub 2>$null }
}

# Start the orb app if the WebSocket server (8765) isn't already up.
$wsUp = (Test-NetConnection 127.0.0.1 -Port 8765 -WarningAction SilentlyContinue).TcpTestSucceeded
if (-not $wsUp) {
  $electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
  Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $root
  for ($i = 0; $i -lt 40; $i++) {
    if ((Test-NetConnection 127.0.0.1 -Port 8765 -WarningAction SilentlyContinue).TcpTestSucceeded) { break }
    Start-Sleep -Milliseconds 700
  }
}

# Start the bridge if it isn't already running.
$bridge = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'bridge\.mjs' }
if (-not $bridge) {
  Start-Process -FilePath 'node' -ArgumentList 'bridge\bridge.mjs' -WorkingDirectory $root -WindowStyle Hidden
}
