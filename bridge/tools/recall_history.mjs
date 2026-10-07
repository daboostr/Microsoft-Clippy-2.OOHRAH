import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = path.join(os.homedir(), '.scout', 'copilot', 'session-store.db');

export const spec = {
  type: 'function',
  function: {
    name: 'recall_history',
    description: 'Search the user\'s past Scout conversation history (previous sessions) for a topic, and return dated snippets. Use this whenever the user asks what you/they discussed before, to recall a prior conversation, decision, person, or project from earlier sessions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords or topic to search for across past sessions.' },
        limit: { type: 'number', description: 'Max snippets (default 6).' }
      },
      required: ['query'],
      additionalProperties: false
    }
  }
};

// Build an FTS5 MATCH expression that is forgiving: OR the significant words.
function toMatch(q) {
  const words = String(q).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (!words.length) return null;
  const uniq = [...new Set(words)].slice(0, 8);
  return uniq.map((w) => '"' + w + '"').join(' OR ');
}

export async function run({ query, limit }) {
  const max = Math.max(1, Math.min(12, Number(limit) || 6));
  const match = toMatch(query);
  if (!match) return { error: 'Need at least one search word.' };
  let db;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (e) {
    return { error: 'Cannot open history store: ' + e.message };
  }
  try {
    const rows = db.prepare(
      `SELECT si.session_id AS sid, si.source_type AS src,
              snippet(search_index, 0, '', '', ' … ', 12) AS snip,
              s.summary AS summary, s.updated_at AS updated
       FROM search_index si
       LEFT JOIN sessions s ON s.id = si.session_id
       WHERE search_index MATCH ?
       ORDER BY bm25(search_index)
       LIMIT ?`
    ).all(match, max * 3);

    // Collapse to the best snippet per session, newest first.
    const bySession = new Map();
    for (const r of rows) {
      if (!bySession.has(r.sid)) {
        bySession.set(r.sid, {
          when: (r.updated || '').slice(0, 10),
          topic: (r.summary || '').slice(0, 80) || '(untitled session)',
          snippet: (r.snip || '').replace(/\s+/g, ' ').trim().slice(0, 240)
        });
      }
    }
    const results = [...bySession.values()]
      .sort((a, b) => (b.when || '').localeCompare(a.when || ''))
      .slice(0, max);
    return { query, count: results.length, results };
  } catch (e) {
    return { error: 'History search failed: ' + e.message };
  } finally {
    try { db.close(); } catch (_) {}
  }
}
