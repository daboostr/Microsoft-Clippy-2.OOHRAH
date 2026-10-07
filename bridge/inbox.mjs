import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HANDOFF = path.join(os.homedir(), '.copilot', 'handoff');
const QUEUE = path.join(HANDOFF, 'queue');
const DONE = path.join(HANDOFF, 'done');
const OUT = path.join(HANDOFF, 'handoff-inbox.html');

function readJsonDir(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function card(item, status) {
  const when = esc((item.createdAt || '').replace('T', ' ').slice(0, 19));
  const done = esc((item.completedAt || '').replace('T', ' ').slice(0, 19));
  const result = item.result ? `<div class="result">${esc(item.result)}</div>` : '';
  const badge = status === 'done'
    ? '<span class="b done">DONE</span>'
    : '<span class="b pending">PENDING</span>';
  return `<div class="card ${status}">
    <div class="top">${badge}<span class="sum">${esc(item.summary || item.request || '').slice(0, 80)}</span></div>
    <div class="req">${esc(item.request || '')}</div>
    ${result}
    <div class="meta">queued ${when}${done ? ' · done ' + done : ''} · id ${esc(item.id || '')}</div>
  </div>`;
}

export function renderInbox() {
  try {
    const pending = readJsonDir(QUEUE).map((i) => ({ i, s: 'pending' }));
    const done = readJsonDir(DONE).map((i) => ({ i, s: 'done' }));
    const all = [...pending, ...done].sort((a, b) =>
      String(b.i.createdAt || '').localeCompare(String(a.i.createdAt || '')));
    const cards = all.length ? all.map(({ i, s }) => card(i, s)).join('\n') :
      '<div class="empty">No hand-offs yet. Say "TARS" then give a heavy task.</div>';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>TARS Handoff Inbox</title>
<style>
  body{margin:0;background:#0b1222;color:#e8eefc;font:14px/1.5 "Segoe UI",system-ui,sans-serif;padding:20px}
  h1{font-size:18px;margin:0 0 4px;font-weight:600}
  .sub{color:#8ea3c8;font-size:12px;margin-bottom:16px}
  .card{background:#131c31;border:1px solid #27324d;border-radius:10px;padding:12px 14px;margin:10px 0}
  .card.pending{border-left:3px solid #ffbe0b}
  .card.done{border-left:3px solid #38b000}
  .top{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .b{font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;letter-spacing:.5px}
  .b.pending{background:#5a4a00;color:#ffd84d}
  .b.done{background:#1c3d00;color:#8fe05a}
  .sum{font-weight:600}
  .req{color:#cdd9f2;margin:2px 0}
  .result{background:#0e1830;border:1px solid #27324d;border-radius:8px;padding:8px 10px;margin-top:8px;color:#bfe8c8}
  .meta{color:#6f84a8;font-size:11px;margin-top:8px}
  .empty{color:#6f84a8;padding:30px;text-align:center}
</style></head><body>
<h1>TARS Handoff Inbox</h1>
<div class="sub">Everything the voice orb handed off to the main agent. Auto-refreshes every 5s · ${esc(new Date().toLocaleString())}</div>
${cards}
</body></html>`;
    fs.mkdirSync(HANDOFF, { recursive: true });
    fs.writeFileSync(OUT, html);
    return OUT;
  } catch (_) { return null; }
}
