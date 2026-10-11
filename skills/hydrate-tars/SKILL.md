---
name: "hydrate-tars"
description: "Provision Clippy 2.OOHRAH (TARS Voice) — a hands-free wake-word speech-to-speech (S2S) voice companion for Microsoft Scout — end to end on this machine. Clones the public GitHub repo, installs dependencies (including the Electron and ffmpeg-static binaries that npm's script sandbox skips), then EITHER discovers and reuses an existing Azure AI setup OR provisions a fresh one from scratch. Uses the proven S2S pattern: a SINGLE multi-service AIServices Cognitive Services account WITH a custom domain that serves chat + STT + TTS together (resource group, AIServices account, chat model deployment, and the Cognitive Services User role assignment for keyless Entra ID auth). Writes the .env, creates the launch/stop shortcuts, and starts the orb. Use when the user says 'install TARS', 'hydrate TARS', 'set up Clippy 2.OOHRAH', 'install TARS Voice', 'deploy the voice assistant', or '/hydrate-tars'. Windows + PowerShell only. Requires Node 18+, Azure CLI, git, and an Azure subscription the user can create resources in (no pre-existing Azure AI resources needed; Entra ID auth, no API keys)."
---

# Hydrate TARS Voice (Clippy 2.OOHRAH)

You are provisioning **Clippy 2.OOHRAH / TARS Voice** on the user's Windows machine from the
public repo <https://github.com/daboostr/Microsoft-Clippy-2.OOHRAH>. Work through the phases
in order. Narrate each phase briefly. **Stop and ask** at the decision points marked ⛔ —
never guess or invent Azure resource identifiers, and never leave the install half-finished:
if you start provisioning, run it through to a verified launch.

Project page / overview: <https://daboostr.com/Microsoft-Clippy-2.OOHRAH/>

## What ships baked in (this is NOT a blank template)

This delivers a **fully-formed TARS agent**, not a scaffold the user has to personalize. Every
behavioral piece is already in the repo and comes down with the clone — your job is to stand it
up and **verify the brain is intact**, never to rewrite or water it down:

- **Personality** — the TARS voice (humor 75%, honesty 90%, sarcasm 60%; dry, deadpan, competent,
  never cruel; adjustable on request) lives in `bridge/bridge.mjs` as `PROMPT_ACTIVE` and
  `PROMPT_EASE`. Do NOT replace these with a generic assistant prompt.
- **Instructions / behavior** — Active Duty vs At Ease modes, the delegate-to-Scout rule, the
  search-before-you-opine rule, and the spoken-output style are all encoded in those prompts and
  the tool set (`time`, `calculate`, `web_search`, `fetch_page`, `recall_history`, `delegate`).
- **Grounding to local Scout chat** — `bridge/tools/recall_history.mjs` reads the user's own Scout
  session store at `~/.scout/copilot/session-store.db` (resolved per-machine), so TARS can recall
  what the seller discussed in past Scout sessions. This makes it a continuation of their Scout
  experience, not an amnesiac chatbot.
- **Avatars, audio ceremonies, launcher** — all included.

Target user: a **common seller who uses Scout** and wants a human-like, Marine-Corps-style exec
assistant — a complete experience out of the box. A savvy dev can repurpose it, but the default
delivery is the whole TARS, fully baked.

---

## Phase 0 — Preflight (verify the toolchain)

Run these checks and report a short table (tool → found/missing). Do NOT auto-install
system tools; if one is missing, tell the user how to get it and stop.

```powershell
"node:  " + (node --version 2>&1)
"npm:   " + (npm --version 2>&1)
"git:   " + (git --version 2>&1)
"az:    " + (az version --query '\"azure-cli\"' -o tsv 2>&1)
```

Requirements: **Node 18+**, **npm**, **git**, **Azure CLI**. If Node is missing →
`winget install OpenJS.NodeJS.LTS`. If Azure CLI is missing → `winget install Microsoft.AzureCLI`
(then a new shell is needed for PATH).

This skill can **either reuse an existing Azure AI Foundry + Speech setup OR provision a brand
new one from scratch** (Phase 4). The user does NOT need to have anything in Azure beforehand —
only an Azure subscription they can create resources in.

## Phase 1 — Choose an install location & clone

Default target: `C:\Users\<user>\TARS-Voice` (ask if they want elsewhere). Then:

```powershell
$dest = "$env:USERPROFILE\TARS-Voice"
if (Test-Path $dest) { Write-Host "Folder exists — will pull latest instead of clone." }
else { git clone https://github.com/daboostr/Microsoft-Clippy-2.OOHRAH.git $dest }
# If it already existed:
if (Test-Path "$dest\.git") { git -C $dest pull --ff-only }
Set-Location $dest
```

The repo already ships the animated avatars (`src/renderer/orb-gifs/TARS_*.webp`) and the
transcoded audio beds (`src/renderer/audio/*.wav`) — you do NOT need to render or transcode
anything. They come down with the clone.

## Phase 2 — Install dependencies (mind the sandbox)

`npm install` runs, **but Microsoft Scout's npm runs with scripts sandboxed**, so the two
packages that download binaries in a postinstall step — **electron** and **ffmpeg-static** —
can land without their actual `.exe`. Install, then verify and repair:

```powershell
npm install --no-fund --no-audit
# Verify the binaries the postinstall scripts are supposed to fetch:
$electron = Test-Path ".\node_modules\electron\dist\electron.exe"
$ffmpeg   = Test-Path ".\node_modules\ffmpeg-static\ffmpeg.exe"
"electron.exe: $electron"; "ffmpeg.exe: $ffmpeg"
```

If **electron.exe** is missing, run its installer directly:
```powershell
node .\node_modules\electron\install.js
```
If **ffmpeg.exe** is missing, run ffmpeg-static's installer directly:
```powershell
node .\node_modules\ffmpeg-static\install.js
```
Re-check both paths exist before moving on. ffmpeg is only needed if the user later wants to
re-transcode their own audio; electron is mandatory.

## Phase 2.5 — Verify the baked-in TARS brain

Before touching Azure, confirm the clone actually contains the full agent (personality +
grounding). If any of these are missing, the clone is incomplete — re-pull; do NOT hand-write a
replacement prompt.

```powershell
# Personality prompts present:
$b = Get-Content ".\bridge\bridge.mjs" -Raw
"PROMPT_ACTIVE: " + ($b -match 'PROMPT_ACTIVE')
"PROMPT_EASE:   " + ($b -match 'PROMPT_EASE')
"TARS persona:  " + ($b -match 'humor 75%|You are TARS')
# Grounding tool + full tool set present:
"recall_history tool: " + (Test-Path ".\bridge\tools\recall_history.mjs")
"delegate tool:       " + (Test-Path ".\bridge\tools\delegate.mjs")
"web_search tool:     " + (Test-Path ".\bridge\tools\web_search.mjs")
# Scout session store the grounding reads (per-machine; present if the user uses Scout):
"Scout history DB:    " + (Test-Path "$env:USERPROFILE\.scout\copilot\session-store.db")
```

All of the prompt/tool checks must be `True`. The Scout history DB may be absent on a machine
that has never run Scout — that's fine, grounding simply returns nothing until the user builds
session history; do not treat it as a failure. **Never substitute a generic assistant prompt** —
the TARS personality is the product.

## Phase 3 — ⛔ Azure sign-in & subscription

Everything Azure needs a signed-in CLI first. Confirm, and capture sub + tenant for later:

```powershell
$acct = az account show -o json 2>$null | ConvertFrom-Json
if (-not $acct) { az login | Out-Null; $acct = az account show -o json | ConvertFrom-Json }
$SUB    = $acct.id
$TENANT = $acct.tenantId
"Signed in as $($acct.user.name) on sub $($acct.name) ($SUB)"
```

If the user has **multiple subscriptions**, show `az account list -o table` and let them pick the
one to create resources in, then `az account set --subscription <id>`. Do not assume the default.

## Phase 4 — ⛔ Discover OR provision the Azure resources

**The S2S pattern (read this first — it's the key discovery).** TARS is speech-to-speech, not
just speech-to-text. What actually works is a **single multi-service `AIServices` Cognitive
Services account** that serves **all three** jobs from one resource: the **chat** completion
(Foundry/OpenAI), **STT** (wake word + recognition), and **TTS** (TARS's voice). You do **not**
need a separate Azure OpenAI resource and a separate SpeechServices resource — the reference
config (`efbarbat-azure-s2s-resource`) is one `AIServices` account where both
`FOUNDRY_ENDPOINT` and `SPEECH_RESOURCE_ID` point at the **same** account. Two non-negotiables
that we learned the hard way:

1. **The account MUST have a custom domain** (`--custom-domain`, which makes the
   `<name>.cognitiveservices.azure.com` subdomain). The keyless Speech auth-token format
   `aad#<resourceId>#<token>` only works against a custom-domain (subdomain) resource — a plain
   regional Speech endpoint will NOT accept the AAD token and STT/TTS will silently fail.
2. **Auth is 100% Entra ID, no keys.** Both the chat call and the Speech SDK use a token from
   `az account get-access-token --resource https://cognitiveservices.azure.com`, and the
   signed-in user needs **Cognitive Services User** on the account. The chat call hits the
   `/openai/` path even on an AIServices account:
   `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=2024-10-21`.

**Never leave this half-done** — either reuse what exists or create everything, then verify.
Ask the user which path they want:

> "Do you already have an Azure AI Foundry / AIServices resource (ideally one that also does
> Speech) you want to reuse, or should I provision a fresh S2S resource for you?"

### Path A — Discover & reuse existing resources

Prefer a single **AIServices** account that can do both. List candidates:

```powershell
# AIServices accounts are multi-service (chat + speech). These are the ideal S2S hosts:
az cognitiveservices account list `
  --query "[?kind=='AIServices'].{name:name, rg:resourceGroup, region:location, endpoint:properties.endpoint, customDomain:properties.customSubDomainName}" -o table
# Also show OpenAI-only and Speech-only accounts in case they want to pair two resources:
az cognitiveservices account list `
  --query "[?kind=='OpenAI' || kind=='SpeechServices'].{name:name, rg:resourceGroup, kind:kind, region:location, customDomain:properties.customSubDomainName}" -o table
```

For the chosen account, two checks:
- **It has a custom subdomain** (the `customDomain` column is non-empty). If it's blank, the
  `aad#` Speech token won't work — either set a custom domain or provision a new account (Path B).
- **It has a usable chat deployment** (create one via Path B Step C-2 if not):
```powershell
az cognitiveservices account deployment list -n <ACCOUNT> -g <RG> `
  --query "[].{deployment:name, model:properties.model.name, version:properties.model.version}" -o table
```

If reusing one AIServices account for both, `FOUNDRY_ENDPOINT` = its endpoint,
`SPEECH_RESOURCE_ID` = its ARM id, `SPEECH_REGION` = its region. Confirm the user still has (or
gets) **Cognitive Services User** on it (Step E), then go to Phase 5.

### Path B — Provision a fresh S2S resource from scratch

One `AIServices` account does chat + STT + TTS. Pick a name/region with the user first (the name
must be globally unique for the custom domain). Run the steps **in order** — a partial run leaves
TARS in pieces.

**Step C-1 — Resource group + AIServices account WITH a custom domain** (the custom domain is
what makes keyless Speech work — do not omit it):
```powershell
$RG       = "<rg-name, e.g. rg-tars-voice>"
$LOCATION = "<region, e.g. eastus2>"
$S2S      = "<globally-unique-name>"   # becomes <name>.cognitiveservices.azure.com

az group create -n $RG -l $LOCATION | Out-Null
az cognitiveservices account create -n $S2S -g $RG -l $LOCATION `
  --kind AIServices --sku S0 --custom-domain $S2S --yes | Out-Null
```

**Step C-2 — Chat model deployment.** Confirm the model/version offered in the region before
deploying (don't hardcode a version that isn't available):
```powershell
az cognitiveservices account list-models -n $S2S -g $RG `
  --query "[?contains(name,'gpt')].{name:name, version:version, format:format}" -o table

$DEPLOYMENT = "<chat-deployment-name, e.g. gpt-4.1>"
az cognitiveservices account deployment create -n $S2S -g $RG `
  --deployment-name $DEPLOYMENT `
  --model-name "<e.g. gpt-4.1>" --model-version "<e.g. 2025-04-14>" `
  --model-format OpenAI --sku-name "GlobalStandard" --sku-capacity 50 | Out-Null
```
If the SKU/capacity is rejected for the region, fall back to `--sku-name Standard` or a lower
`--sku-capacity`, and surface the quota error — never silently skip the deployment.

**Step D — No separate Speech resource needed.** The same `$S2S` AIServices account provides STT
and TTS. (Only create a dedicated `--kind SpeechServices` account if the user specifically wants
speech isolated from chat; if so, give it its own `--custom-domain` too, and point
`SPEECH_RESOURCE_ID`/`SPEECH_REGION` at that one instead.)

**Step E — Assign Cognitive Services User to the signed-in user** on the account (this unlocks
BOTH the chat token and the Speech token; skipping it = 401s at runtime):
```powershell
$ME = az ad signed-in-user show --query id -o tsv
$scope = az cognitiveservices account show -n $S2S -g $RG --query id -o tsv
az role assignment create --assignee $ME --role "Cognitive Services User" --scope $scope | Out-Null
```
RBAC can take ~60s to propagate. If the first launch 401s, wait and relaunch.

## Phase 5 — Write the .env

Copy the template and fill it from the **resolved or newly-created** resources (never invent
values; never echo secrets to chat). `.env` is gitignored — it must never be committed.

```powershell
if (-not (Test-Path .\.env)) { Copy-Item .\.env.example .\.env }
```

Resolve the final values from the one S2S account (`$S2S` from Path B, or the reused account):

```powershell
$ACCT = $S2S            # or the discovered AIServices account name
$FOUNDRY_ENDPOINT = az cognitiveservices account show -n $ACCT -g $RG --query properties.endpoint -o tsv
$SPEECH_RESOURCE  = az cognitiveservices account show -n $ACCT -g $RG --query id -o tsv
$SPEECH_REGION    = az cognitiveservices account show -n $ACCT -g $RG --query location -o tsv
```

Both `FOUNDRY_ENDPOINT` and `SPEECH_RESOURCE_ID` come from the **same** account (that's the S2S
pattern). If the user chose a dedicated Speech resource in Phase 4 Step D, point the `SPEECH_*`
values at that one instead.

| Key | Value | Notes |
| --- | --- | --- |
| `FOUNDRY_ENDPOINT` | `https://<ACCT>.cognitiveservices.azure.com` | the account's `properties.endpoint` |
| `FOUNDRY_DEPLOYMENT` | the `$DEPLOYMENT` name | e.g. `gpt-4.1` |
| `FOUNDRY_API_VERSION` | `2024-10-21` | proven working version; `2025-04-01-preview` also works |
| `SPEECH_REGION` | the account's region | e.g. `eastus2` |
| `SPEECH_RESOURCE_ID` | full ARM id `/subscriptions/.../accounts/<ACCT>` | **same account** as FOUNDRY |
| `SPEECH_VOICE` | `en-US-DavisNeural` | TARS's default voice (deep, dry) |
| `AZURE_SUBSCRIPTION_ID` | `$SUB` from Phase 3 | |
| `AZURE_TENANT_ID` | `$TENANT` from Phase 3 | |

Confirm every line is filled (no remaining `<...>` placeholders) before launching.

### S2S config reference — the exact wiring that works

For reference/debugging, this is how the app consumes the config (do not change these in code,
just make sure the resource supports them):

- **Chat (bridge):** `POST {FOUNDRY_ENDPOINT}/openai/deployments/{FOUNDRY_DEPLOYMENT}/chat/completions?api-version={FOUNDRY_API_VERSION}`
  with header `Authorization: Bearer <aad-token>`, token from `--resource https://cognitiveservices.azure.com`.
- **Speech STT + TTS (bridge & renderer):** `SpeechConfig.fromAuthorizationToken("aad#" + SPEECH_RESOURCE_ID + "#" + <aad-token>, SPEECH_REGION)`.
  The `aad#<resourceId>#<token>` format is why the account needs a **custom domain**.
- **TTS output format:** `Riff24Khz16BitMonoPcm`; voice `SPEECH_VOICE`.
- **Token resource (both):** `https://cognitiveservices.azure.com`; **RBAC:** `Cognitive Services User` on the account.

**Auth model:** Entra ID (AAD), not keys. A 401 at runtime almost always means the Cognitive
Services User role is missing/propagating, or the account lacks a custom domain.

## Phase 6 — Desktop shortcuts (optional but recommended)

The repo ships `TARS.vbs` / `Stop-TARS.vbs` (fully detached launch/stop wrappers). Offer to
drop Start-menu / desktop shortcuts to them:
```powershell
$dest = (Get-Location).Path
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:USERPROFILE\Desktop\TARS Voice.lnk")
$lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments  = "`"$dest\TARS.vbs`""
$lnk.WorkingDirectory = $dest
$lnk.IconLocation = "$dest\resources\TARS.ico"
$lnk.Save()
# Stop shortcut:
$lnk2 = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Stop TARS.lnk")
$lnk2.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk2.Arguments  = "`"$dest\Stop-TARS.vbs`""
$lnk2.WorkingDirectory = $dest
$lnk2.IconLocation = "$dest\resources\TARS-stop.ico"
$lnk2.Save()
```

## Phase 7 — Launch & verify

Start the stack with the idempotent launcher:
```powershell
powershell -ExecutionPolicy Bypass -File .\launch-tars.ps1
```
Then verify it actually came up:
```powershell
Start-Sleep 4
"WS 8765:  " + ((Test-NetConnection 127.0.0.1 -Port 8765 -WarningAction SilentlyContinue).TcpTestSucceeded)
"electron: " + ((Get-Process electron -EA SilentlyContinue | Measure-Object).Count) + " procs"
"bridge:   " + [bool](Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'bridge\.mjs' })
```
Success = WS 8765 listening, at least one electron process, and the bridge node process
running. The translucent orb should appear and TARS should announce itself.

## Phase 8 — Hand off to the Marine

Tell the user:
- Say **"TARS"** to wake it; just start talking to interrupt it.
- **"At Ease"** / **"Active Duty"** switch modes; **"TARS, shut down"** exits with the Salute + Taps.
- On **Active Duty**, heavy requests are delegated to this Scout agent via `~/.copilot/handoff`
  — keep Microsoft Scout running to work those jobs. Open `~/.copilot/handoff/handoff-inbox.html`
  to watch the queue.
- To relaunch after a reboot: the **TARS Voice** desktop shortcut (or `launch-tars.ps1`).

## Troubleshooting

- **Orb never appears / WS 8765 never opens:** electron.exe missing → rerun `node node_modules\electron\install.js`.
- **Silent / no voice, or 401 in the bridge window:** Azure auth. Re-run `az login`, confirm
  the identity has Cognitive Services User on the account, and that `.env` IDs are correct.
  Freshly-assigned RBAC can take ~60s to propagate — wait and relaunch.
- **STT/TTS fails but chat works (or vice-versa) on the same account:** the account is missing a
  **custom domain**, so the `aad#<resourceId>#<token>` Speech auth is rejected. Check
  `az cognitiveservices account show -n <ACCT> -g <RG> --query properties.customSubDomainName`;
  if blank, the resource can't do keyless Speech — provision a new AIServices account WITH
  `--custom-domain` (Phase 4 Path B).
- **`deployment create` fails with a quota / capacity error:** the region can't offer that
  `--sku-capacity` or model version. Lower `--sku-capacity`, try `--sku-name Standard`, pick a
  different region, or request quota. Surface the exact error — don't skip the deployment.
- **`account create` fails "name already taken":** the custom-domain name is global; pick a
  different `$FOUNDRY` / `$SPEECH` name.
- **Provisioning stopped partway (resources exist but no .env / no deployment):** do NOT start
  over blindly — re-run Phase 4 Path A discovery to see what already exists, create only the
  missing piece (RG, account, deployment, Speech, or role), then continue. Leave no orphaned
  half-build.
- **Audio files won't play:** only matters if the user swapped in their own clips; re-transcode
  with the bundled ffmpeg (`node_modules\ffmpeg-static\ffmpeg.exe -i in.wav -ar 48000 -ac 2 out.wav`).
- **"hit my reasoning limit" on multi-step asks:** that was fixed upstream; `git -C <dest> pull`.
- **Nothing happens on a delegated task:** Microsoft Scout isn't running, or isn't watching the
  handoff queue. Start Scout and keep it open.
- **"Error reaching Azure" / intermittent failures on corporate networks (esp. Microsoft corpnet):**
  Some corporate DNS resolvers intermittently SERVFAIL the `*.cognitiveservices.azure.com` zone
  and also block outbound port-53 DNS to public resolvers — so a single network blip can make a
  chat/voice call fail. The bridge already mitigates this (retry with backoff + a DNS-over-HTTPS
  fallback that resolves the Azure host over 443 and connects to the IP). If you still see
  failures: confirm DoH egress on 443 isn't blocked (`Invoke-RestMethod https://cloudflare-dns.com/dns-query?name=<ACCT>.cognitiveservices.azure.com&type=A -Headers @{accept='application/dns-json'}`),
  and report the flaky zone resolution to the network team — it's a corpnet DNS issue, not an app
  or Azure fault. The resource itself is reachable (verify with
  `az cognitiveservices account show -n <ACCT> -g <RG> --query properties.provisioningState`).

## Guardrails

- This is Windows + PowerShell only.
- Never commit `.env` or print its secret values back into the chat.
- Don't fabricate Azure endpoints, GUIDs, or resource IDs — always get them from the user or `az`.
- **Finish what you start.** If you provision Azure, carry it through to a verified launch
  (Phase 7). If something fails, diagnose and repair in place — never abandon a partial build.
- Avatars and the author's likeness are CC BY-NC-ND 4.0 (non-commercial, no derivatives); the
  code is MIT. Don't repackage the avatars into other products.
