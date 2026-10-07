# Microsoft Clippy 2.OOHRAH

> *"Everybody good? Plenty of slaves for my robot colony?"*

**TARS Voice** — a hands-free, wake-word desktop voice companion with the TARS personality from *Interstellar*, built to ride shotgun with [Microsoft Scout](https://aka.ms/scout). It listens for "**TARS**", talks back in a neural voice, lets you talk right over it (natural barge-in), searches the web when it doesn't know something, hands long-running tasks off to your Scout agent, and shows an animated 3D avatar for each of its states — complete with a bugle send-off.

Humor setting: 75%. Honesty: 90%. Both adjustable.

---

## What it does

- **Wake word** — Say "TARS" and it wakes up. No hotkeys, no clicking.
- **Speech-to-speech** — Azure AI Foundry chat (`gpt-4.1`) + Azure neural TTS. Ask a question out loud, get a spoken answer.
- **Natural barge-in** — Start talking while TARS is mid-sentence and it stops and listens, like a real conversation. (Echo cancellation runs in the renderer so TARS doesn't hear itself.)
- **Web search** — When asked about something it doesn't know (stock prices, current events, banking trends), it searches the web and answers from live results.
- **Two duty modes** — both stay awake and listening; what changes is whether TARS does *work* or just *talks*.
  - **Active Duty** — on the clock. Full toolset **including task delegation** — ask for real work (file ops, multi-step research, anything heavy) and TARS hands it off to your Scout agent. Crisp, mission-focused answers.
  - **At Ease** — off duty. A relaxed speech-to-speech chat and companion. Same tools **minus delegation** — it won't run or hand off tasks; if you ask for real work it tells you to put it back on Active Duty first. Chattier, asks questions, keeps you company.
- **Handoff to Scout** — Ask TARS to do heavy lifting and it drops a task into a handoff queue your main Scout agent picks up.
- **Session recall** — Remembers the thread of your conversation.
- **Animated 3D avatars** — A different animated pose for each state (Active Duty, At Ease, Listening, Thinking, Speaking) plus a **Salute** on shutdown.
- **Audio ceremonies** — A soft *Taps* bugle bed plays under TARS's shutdown sign-off; the *Marine Corps Hymn* hums quietly while it's thinking.

---

## Architecture

Three cooperating pieces:

```
┌─────────────────────────────────────────────────────────────┐
│  Electron app  (src/main/main.js)                            │
│   • transparent, frameless, click-through orb window + tray  │
│   • WebSocket server on 127.0.0.1:8765                        │
│   • mints Azure AAD tokens for Speech (via `az`)             │
│   • relays messages between renderer and bridge              │
└───────────────┬─────────────────────────────┬───────────────┘
                │ IPC                          │ WebSocket
      ┌─────────▼──────────┐         ┌─────────▼──────────────┐
      │ Renderer           │         │ Bridge (Node process)  │
      │ (src/renderer)     │         │ (bridge/bridge.mjs)    │
      │  • STT / wake word │         │  • chat loop (7 hops)  │
      │  • TTS playback    │         │  • tools: web_search,  │
      │    (Web Audio +    │         │    fetch_page          │
      │    echo cancel)    │         │  • TTS orchestration   │
      │  • avatar display  │         │  • handoff + shutdown  │
      └────────────────────┘         └────────────────────────┘
```

**Why TTS lives in the renderer:** playing TARS's voice through Chromium's Web Audio pipeline lets the browser's acoustic echo canceller subtract TARS's own voice from the microphone. That's what makes talk-over barge-in work — without it, TARS would constantly interrupt itself.

---

## Prerequisites

1. **Windows** with PowerShell.
2. **Node.js 18+** and **npm**.
3. **Azure CLI** (`az`) — signed in to a subscription that owns your Azure AI resource.
4. **An Azure AI Foundry / Azure OpenAI resource** with:
   - A chat deployment (e.g. `gpt-4.1`).
   - An Azure **Speech** resource (neural TTS) in the same region is recommended.
   - **AAD (Entra) auth** — this app authenticates with Azure AD tokens, not API keys. It mints tokens with `az account get-access-token --resource https://cognitiveservices.azure.com`. Make sure your signed-in identity has **Cognitive Services User** (or equivalent) on the resources.
5. **Microsoft Scout** (optional) — only needed for the task-handoff feature.

---

## Setup

```powershell
git clone https://github.com/DaBoostR/Microsoft-Clippy-2.OOHRAH.git
cd Microsoft-Clippy-2.OOHRAH
npm install
```

Copy the environment template and fill in your own resource details:

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env` is **gitignored** — your resource IDs never leave your machine. Fill in:

| Variable | What it is |
| --- | --- |
| `FOUNDRY_ENDPOINT` | Your Azure AI Foundry / OpenAI endpoint URL |
| `FOUNDRY_DEPLOYMENT` | Chat deployment name (e.g. `gpt-4.1`) |
| `FOUNDRY_API_VERSION` | API version your deployment supports |
| `SPEECH_REGION` | Azure region of your Speech resource (e.g. `eastus2`) |
| `SPEECH_RESOURCE_ID` | Full resource ID of your Speech resource (`/subscriptions/.../accounts/<name>`) |
| `SPEECH_VOICE` | Neural voice name (default `en-US-DavisNeural`) |
| `AZURE_SUBSCRIPTION_ID` | Subscription the launcher targets before login |
| `AZURE_TENANT_ID` | Tenant to sign into if `az` isn't already authenticated |

Sign in to Azure CLI once (the launcher will prompt you if you skip this):

```powershell
az login
```

---

## Run

The easy way — the launcher starts Scout, the orb, and the bridge idempotently:

```powershell
powershell -ExecutionPolicy Bypass -File .\launch-tars.ps1
```

Or run just the Electron orb directly:

```powershell
npm start
```

To stop everything:

```powershell
powershell -ExecutionPolicy Bypass -File .\stop-tars.ps1
```

`TARS.vbs` / `Stop-TARS.vbs` are fully-detached launch/stop wrappers you can pin to the taskbar or a desktop shortcut.

---

## Voice commands

| Say | TARS does |
| --- | --- |
| **"TARS"** | Wakes up and listens |
| *(just start talking while it speaks)* | Interrupts — it stops and listens |
| **"At Ease"** / **"Stand down"** / **"Off duty"** | Switches to At Ease mode (stays listening, drops task delegation) |
| **"Active Duty"** / **"Attention"** / **"Back to work"** | Returns to Active Duty (re-enables task delegation) |
| **"TARS, shut down"** | Plays the Salute + Taps send-off and exits |

Humor and honesty levels are adjustable in the bridge prompts (`bridge/bridge.mjs`).

---

## Duty modes at a glance

Both modes keep the microphone live and the TARS personality intact. The real difference is **capability** — Active Duty can put your Scout agent to work; At Ease is purely for conversation. Switching modes also starts a fresh conversation thread.

| | 🫡 Active Duty | 😎 At Ease |
| --- | --- | --- |
| **Posture** | On the clock, mission-focused | Off duty, relaxed companion |
| **Delegate tasks to Scout** | ✅ Yes — hands off file ops, multi-step research, heavy/destructive work | ❌ No — tells you to go back on Active Duty first |
| **Tools** | time, calculate, web_search, fetch_page, recall_history, **delegate** | time, calculate, web_search, fetch_page, recall_history |
| **Web search** | ✅ | ✅ |
| **Listening / wake word** | ✅ Always | ✅ Always |
| **Answer style** | Crisp, one or two spoken sentences | Conversational, one to three sentences, asks questions and riffs |
| **Switch into it by saying** | "Active Duty", "Attention", "Back to work", "On duty", "Work mode" | "At Ease", "Stand down", "Off duty", "Relax", "Let's chat" |

> Note: "**Stand down**" means *At Ease* (relax), **not** shutdown. To actually exit, say "**TARS, shut down**" (or "power down", "dismissed").

---

## Project layout

```
.
├── src/
│   ├── main/            Electron main process (window, tray, WS server, token minting)
│   └── renderer/        Orb UI, STT/wake word, TTS playback, avatars, audio beds
├── bridge/
│   ├── bridge.mjs       Chat loop, tool orchestration, TTS + shutdown
│   └── tools/           web_search.mjs, fetch_page.mjs
├── resources/           Icons / static assets
├── launch-tars.ps1      Idempotent launcher (reads .env for Azure context)
├── stop-tars.ps1        Stops only this app's processes
├── TARS.vbs / Stop-TARS.vbs   Detached launch/stop wrappers
├── .env.example         Config template (copy to .env)
└── package.json
```

---

## Privacy & secrets

- **No API keys ship in this repo.** Auth is Azure AD token-based.
- Your real `.env` (endpoint, resource IDs, subscription, tenant) is gitignored and stays local.
- The shipping source contains **no hardcoded subscription, tenant, or resource identifiers** — everything resolves from your `.env`.

---

## Credits

Built as a companion to Microsoft Scout. TARS persona and quotes are an homage to *Interstellar* (© Warner Bros.) — this is a fan-made, non-commercial tribute.

🫡 *Oorah.*

---

## License

[MIT](./LICENSE) © 2026 DaBoostR
