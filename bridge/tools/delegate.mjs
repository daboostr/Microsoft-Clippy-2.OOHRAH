import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const HANDOFF = path.join(os.homedir(), '.copilot', 'handoff');
const QUEUE = path.join(HANDOFF, 'queue');
const STORE = path.join(os.homedir(), '.scout', 'copilot', 'session-store.db');

export const spec = {
  type: 'function',
  function: {
    name: 'delegate',
    description: 'Hand a request off to the main Scout agent, which has full tooling (email, calendar, files, code, MSX/Dataverse, skills, multi-step research, browser, anything destructive). Call this for ANYTHING you cannot fully do yourself with your own small tool set, including launching a skill, starting a new chat/task, drafting or sending mail, reading the user\'s data, or any heavy or multi-step or destructive action. Do NOT answer such requests yourself. If the request refers to a past conversation, chat, our discussion, or this build/session, pass it along so the relevant local Scout history can be attached automatically.',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'The full user request, verbatim or lightly cleaned, for the agent to execute.' },
        summary: { type: 'string', description: 'A 3-6 word label of the task.' }
      },
      required: ['request'],
      additionalProperties: false
    }
  }
};

// Does this request reference a past conversation / the current build / session history?
const CONVO_REF = /\b(this|our|the|my|that)\s+(chat|conversation|session|discussion|thread|build|work|history)\b|\bchat history\b|\bwhat we (discussed|did|built|talked about)\b|\bour (conversation|work|discussion|session)\b|\bthis session\b|\bsummar(y|ize|ise)[^.]*\b(chat|conversation|session|build|discussion)\b/i;

const STOPWORDS = new Set(['the','a','an','and','or','of','to','for','in','on','my','me','our','this','that','with','about','please','send','give','email','e-mail','summary','summarize','summarise','write','draft','full','regarding','history','chat','conversation','session','discussion','build','work','it','is','are','you','want','need','get','can','could','would']);

function keywords(text) {
  const words = String(text).toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  const uniq = [];
  for (const w of words) { if (!STOPWORDS.has(w) && !uniq.includes(w)) uniq.push(w); }
  return uniq.slice(0, 8);
}

// Pull a compact transcript of the best-matching recent session as handoff context.
function gatherContext(request) {
  if (!CONVO_REF.test(request)) return null;
  if (!fs.existsSync(STORE)) return null;
  let db;
  try { db = new DatabaseSync(STORE, { readOnly: true }); } catch (_) { return null; }
  try {
    const kws = keywords(request);
    let sessionId = null;
    // 1) Match a session by the request's content keywords (excludes the
    //    handoff-executor's own noise sessions).
    if (kws.length) {
      const match = kws.map((w) => '"' + w + '"').join(' OR ');
      try {
        const rows = db.prepare(
          `SELECT si.session_id AS sid, COUNT(*) AS hits, s.updated_at AS updated
           FROM search_index si
           LEFT JOIN sessions s ON s.id = si.session_id
           WHERE search_index MATCH ?
             AND (s.summary IS NULL OR s.summary NOT LIKE 'You are the main Scout agent%')
           GROUP BY si.session_id
           ORDER BY hits DESC, s.updated_at DESC
           LIMIT 1`
        ).all(match);
        if (rows.length) sessionId = rows[0].sid;
      } catch (_) {}
    }
    // 2) Fallback: most recent substantive session (not a handoff-executor run).
    if (!sessionId) {
      try {
        const r = db.prepare(
          `SELECT id FROM sessions
           WHERE summary IS NULL OR summary NOT LIKE 'You are the main Scout agent%'
           ORDER BY updated_at DESC LIMIT 1`
        ).get();
        if (r) sessionId = r.id;
      } catch (_) {}
    }
    if (!sessionId) return null;

    const summaryRow = db.prepare('SELECT summary, updated_at FROM sessions WHERE id = ?').get(sessionId) || {};
    const turns = db.prepare(
      'SELECT turn_index, user_message, assistant_response FROM turns WHERE session_id = ? ORDER BY turn_index ASC'
    ).all(sessionId);
    if (!turns.length) return null;

    const parts = [];
    for (const t of turns) {
      const u = (t.user_message || '').replace(/\s+/g, ' ').trim();
      const a = (t.assistant_response || '').replace(/\s+/g, ' ').trim();
      if (u) parts.push('User: ' + u);
      if (a) parts.push('Assistant: ' + a);
    }
    let transcript = parts.join('\n');
    const BUDGET = 9000; // keep the most recent turns within a sane handoff size
    if (transcript.length > BUDGET) transcript = '…(earlier turns omitted)…\n' + transcript.slice(transcript.length - BUDGET);

    return {
      sessionId,
      sessionSummary: (summaryRow.summary || '').slice(0, 120),
      updatedAt: summaryRow.updated_at || null,
      turnCount: turns.length,
      transcript
    };
  } catch (_) {
    return null;
  } finally {
    try { db.close(); } catch (_) {}
  }
}

export async function run({ request, summary }) {
  try {
    fs.mkdirSync(QUEUE, { recursive: true });
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const item = {
      id,
      request: String(request || '').trim(),
      summary: String(summary || '').trim(),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    // Auto-attach local Scout conversation history when the request references it,
    // so the executor has the raw material instead of hunting for it.
    const ctx = gatherContext(item.request);
    if (ctx) {
      item.context = ctx;
      item.note = 'Local Scout conversation history is attached in context.transcript — use it as the source material; do not ask the user for a link.';
    }
    fs.writeFileSync(path.join(QUEUE, id + '.json'), JSON.stringify(item, null, 2));
    return {
      queued: true, id,
      contextAttached: !!ctx,
      note: ctx
        ? 'Handed to the main agent with the relevant local chat history attached. It will work the task and report back out loud.'
        : 'Handed to the main agent. It will work the task and report back out loud.'
    };
  } catch (e) {
    return { queued: false, error: e.message };
  }
}
