# Handoff Executor Automation (recoverable spec)

TARS's voice orb has a deliberately small toolset. Anything bigger — email, calendar,
files, code, MSX/Dataverse, skills, multi-step research, browser, destructive actions —
is written as a job file into a shared handoff queue that a **Microsoft Scout automation**
drains and executes. This file is the canonical, tool-independent copy of that automation
so it can be rebuilt from scratch if the Scout automation config is ever lost.

## Queue layout (Windows)

```
C:\Users\<user>\.copilot\handoff\
  queue\<id>.json         pending jobs written by the orb (delegate tool)
  replies\<id>.txt        short spoken-style result, read aloud by the orb
  done\<id>.json          processed jobs (status + completedAt + result)
  teams-outbox\<id>.txt   fallback copy of the Teams notification (drainable)
  handoff-inbox.html      live Pending/Done view
```

Each queue job: `{ id, request, summary, status, createdAt, [context], [note] }`.
When the spoken request references past conversation/this build, the `delegate` tool
auto-attaches a `context` object `{ sessionId, sessionSummary, updatedAt, turnCount, transcript }`
read from `~/.scout/copilot/session-store.db` so the executor has the raw material.

## Automation config

- **Name:** `Voice Handoff Queue`
- **Trigger:** schedule, every **1 minute** (low-latency polling)
- **teamsNotify:** `never` — the framework's auto/always surfacing is NOT used.
  - `auto` was observed to silently drop the executor's final response (not judged
    "worth surfacing"), so the user got no ping.
  - `always` would post the empty-run `NO_QUEUE_ITEMS` sentinel ~1,440x/day — spam.
  - Instead the executor calls `m_send_teams_message` **directly**, only when it
    processed real work, and also writes the message to `teams-outbox\` as a fallback.
    A background automation run CAN reach the Teams relay with a direct tool call
    (verified 2026-10-07).

## Notification contract

- **Empty run:** executor's entire response is exactly `NO_QUEUE_ITEMS`; no Teams send.
- **Real work:** executor composes ONE scannable phone-ready message (per-item: what it
  did + exactly where to find the artifact + any question), then delivers it BOTH ways:
  1. `m_send_teams_message` (primary)
  2. write the same text to `teams-outbox\<id>.txt` (fallback drain)
- Spoken `replies\<id>.txt` never references Teams.

## Executor prompt (verbatim)

> You are the main Scout agent acting as the executor for the Scout Voice orb's handoff queue.
>
> Queue location (Windows): C:\Users\efbarbat\.copilot\handoff
> - Pending requests: queue\*.json  (each: {id, request, summary, status, createdAt, [context], [note]})
> - Write spoken replies to: replies\<id>.txt
> - Move processed requests to: done\<id>.json
> - Teams outbox (fallback): teams-outbox\<id>.txt
>
> STEP 1 — Read the queue:
> List the queue for *.json files. If there are NONE, do nothing further: reply with exactly "NO_QUEUE_ITEMS" and stop. Do NOT send any Teams message on an empty run.
>
> STEP 2 — For EACH pending item (oldest createdAt first):
>   a. Parse its "request" field — a spoken command from the user via the voice orb.
>   b. ATTACHED CONVERSATION CONTEXT: If the item has a "context" field, the relevant local history is ALREADY ATTACHED — do NOT ask the user for a chat link or transcript. context.transcript = a recent excerpt (primary source). context.sessionId = full conversation in session-store.db (table "turns"); read it directly if more is needed.
>   c. Execute the request fully using all tools. Honor privacy rules. If destructive or sends to other people, prepare a DRAFT instead and say so.
>   d. Write a SHORT spoken-style result (1-2 sentences, plain text, deadpan TARS tone ok) to replies\<id>.txt. Do NOT reference Teams.
>   e. Name artifacts by what the user asked for — include the key person/account/topic.
>   f. If clarifying info is needed, do what you can (e.g. a draft with a placeholder), then put the question in the Teams message; set status "waiting-on-user".
>   g. Move the queue file to done\<id>.json with added status, completedAt, result. Drop the large context field from the done copy.
>
> STEP 3 — NOTIFY THE USER (only when STEP 2 processed at least one item):
> Compose ONE clear, scannable phone-ready message (per item: what you did + exactly where to find the artifact + any question). Deliver it BOTH ways: (1) call m_send_teams_message with the text; (2) write the same text to teams-outbox\<id>.txt. Final response restates the same message.
