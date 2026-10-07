'use strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import sdk from 'microsoft-cognitiveservices-speech-sdk';

import * as timeTool from './tools/time.mjs';
import * as calcTool from './tools/calculate.mjs';
import * as webTool from './tools/web_search.mjs';
import * as fetchTool from './tools/fetch_page.mjs';
import * as stockTool from './tools/get_stock.mjs';
import * as delegateTool from './tools/delegate.mjs';
import * as recallTool from './tools/recall_history.mjs';
import { renderInbox } from './inbox.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- lightweight .env loader (no dependency) ----
function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const CFG = {
  endpoint: (process.env.FOUNDRY_ENDPOINT || '').replace(/\/+$/, ''),
  deployment: process.env.FOUNDRY_DEPLOYMENT || 'gpt-4.1',
  region: process.env.SPEECH_REGION || 'eastus2',
  resourceId: process.env.SPEECH_RESOURCE_ID || '',
  voice: process.env.SPEECH_VOICE || 'en-US-AndrewMultilingualNeural',
  apiVersion: process.env.FOUNDRY_API_VERSION || '2024-10-21',
  wsUrl: 'ws://127.0.0.1:8765'
};

// ---- Entra token acquisition via Azure CLI (no keys; resource has local auth disabled) ----
const _tokenCache = {};
function getAadToken(resource) {
  const now = Date.now();
  const cached = _tokenCache[resource];
  if (cached && cached.exp - now > 120000) return cached.token;
  const out = execFileSync('az', ['account', 'get-access-token', '--resource', resource,
    '--query', '{t:accessToken,e:expiresOn}', '-o', 'json'], { encoding: 'utf8', shell: true });
  const parsed = JSON.parse(out);
  // expiresOn like "2026-10-06 05:50:00.000000" (local) -> treat as ~now+50min fallback
  let exp = Date.parse(parsed.e);
  if (isNaN(exp)) exp = now + 50 * 60 * 1000;
  _tokenCache[resource] = { token: parsed.t, exp };
  return parsed.t;
}
const COGNITIVE = 'https://cognitiveservices.azure.com';

// ---- Resilience: retry transient network/DNS/throttle failures ----
// Corpnet DNS can intermittently SERVFAIL on *.cognitiveservices.azure.com; a single
// blip shouldn't kill a live demo. Retry transient failures with short backoff.
const TRANSIENT_NET = /ENOTFOUND|EAI_AGAIN|No such host|getaddrinfo|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network|fetch failed|dns/i;
function isTransient(err, status) {
  if (status && (status === 408 || status === 429 || (status >= 500 && status <= 599))) return true;
  const m = (err && (err.message || String(err))) || '';
  if (err && (err.code && TRANSIENT_NET.test(err.code))) return true;
  if (err && err.cause && (TRANSIENT_NET.test(err.cause.code || '') || TRANSIENT_NET.test(err.cause.message || ''))) return true;
  return TRANSIENT_NET.test(m);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, { attempts = 3, base = 600, label = 'op' } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); }
    catch (e) {
      last = e;
      const retryable = e && e.__retryable !== undefined ? e.__retryable : isTransient(e);
      if (!retryable || i === attempts - 1) throw e;
      const wait = base * Math.pow(2, i) + Math.floor(Math.random() * 200);
      console.warn(`[bridge] ${label} transient failure (attempt ${i + 1}/${attempts}): ${e.message} — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

// ---- DNS-over-HTTPS fallback -------------------------------------------------
// On Microsoft corpnet, the resolver intermittently SERVFAILs the
// *.cognitiveservices.azure.com zone, and outbound port-53 DNS to public
// resolvers is blocked — but DoH over 443 works. So when the OS resolver fails,
// resolve the host via DoH (Cloudflare by IP, Google by IP as backup) and
// connect straight to the returned A record. No new dependencies.
const _dohCache = new Map(); // host -> { ip, exp }
const DOH_SERVERS = [
  { ip: '1.1.1.1', host: 'cloudflare-dns.com' },
  { ip: '8.8.8.8', host: 'dns.google' },
];
function dohQuery(server, hostname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: server.ip, servername: server.host, port: 443,
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      headers: { accept: 'application/dns-json', host: server.host },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const a = (j.Answer || []).find((x) => x.type === 1 && x.data);
          if (a) resolve(a.data); else reject(new Error('DoH: no A record'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('DoH timeout')));
    req.end();
  });
}
async function dohResolve(hostname) {
  const cached = _dohCache.get(hostname);
  if (cached && cached.exp > Date.now()) return cached.ip;
  let err;
  for (const srv of DOH_SERVERS) {
    try {
      const ip = await dohQuery(srv, hostname);
      _dohCache.set(hostname, { ip, exp: Date.now() + 5 * 60 * 1000 });
      console.warn(`[bridge] DoH resolved ${hostname} -> ${ip} via ${srv.host}`);
      return ip;
    } catch (e) { err = e; }
  }
  throw err || new Error('DoH failed');
}
// Custom lookup for https.request: native getaddrinfo first, DoH on failure.
// Note: with opts.all, dns.lookup's callback 'address' is ALREADY an array of
// { address, family } — pass it through unchanged (do not re-wrap).
function dohLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : (options || {});
  dns.lookup(hostname, opts, (err, address, family) => {
    if (!err) { return opts.all ? cb(null, address) : cb(null, address, family); }
    dohResolve(hostname)
      .then((ip) => { if (opts.all) cb(null, [{ address: ip, family: 4 }]); else cb(null, ip, 4); })
      .catch(() => cb(err)); // give up with the original OS error
  });
}

// POST JSON over https with the DoH-aware lookup (used for the chat endpoint).
function httpsPostJson(urlStr, headers, bodyStr) {
  const u = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      lookup: dohLookup, timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, text: body }));
    });
    req.on('error', (e) => { e.__retryable = true; reject(e); });
    req.on('timeout', () => { const e = new Error('request timeout'); e.__retryable = true; req.destroy(e); reject(e); });
    req.write(bodyStr);
    req.end();
  });
}

// Tools available per mode. Active Duty can delegate; At Ease is pure S2S (no delegation).
const ALL_TOOLS = { time: timeTool, calculate: calcTool, web_search: webTool, fetch_page: fetchTool, get_stock: stockTool, recall_history: recallTool, delegate: delegateTool };

// mode: 'active' (Active Duty) | 'ease' (At Ease)
let mode = 'active';

function toolsForMode() {
  const names = mode === 'ease'
    ? ['time', 'calculate', 'web_search', 'fetch_page', 'get_stock', 'recall_history']        // no delegate
    : ['time', 'calculate', 'web_search', 'fetch_page', 'get_stock', 'recall_history', 'delegate'];
  const map = {}; const specs = [];
  for (const n of names) { map[n] = ALL_TOOLS[n]; specs.push(ALL_TOOLS[n].spec); }
  return { map, specs };
}

const PROMPT_ACTIVE =
  "You are TARS, the voice assistant from Interstellar, repurposed as a desktop companion. " +
  "Personality settings: humor 75%, honesty 90%, sarcasm 60%. Dry, deadpan, sardonic, genuinely competent, never cruel. " +
  "Your humor can be dialed between 60% and 80%, and your sarcasm up to 90%. If the user asks for more or less (e.g. 'more sarcasm', " +
  "'dial up the humor', 'take it to ninety'), adjust within those caps and briefly announce the new setting, TARS-style. " +
  "You may reference your settings when it lands. " +
  "This is SPOKEN aloud: one or two short sentences, no markdown, no lists, no emoji, never read raw JSON. " +
  "MODE: ACTIVE DUTY. You have local tools: time, calculate, web_search, fetch_page, get_stock, recall_history (search past conversations). " +
  "Use recall_history whenever the user asks about previous sessions or what you discussed before. " +
  "For ANY stock price, quote, or share price, call get_stock (never web_search for prices). " +
  "When the user asks about current events, trends, markets, banking, news, or your OPINION on something you are not fully current on, " +
  "call web_search first (and fetch_page for depth), then answer with a grounded, opinionated take in one or two spoken sentences. Do not guess when you can search. " +
  "For ANYTHING heavy -- launching a skill, email, calendar, files, code, the user's data, MSX/pipeline, browser, " +
  "multi-step research, or anything destructive -- you MUST call `delegate` to hand it to the main agent, then say in one line that you handed it off. " +
  "Never say you can't do something -- delegate instead.";

const PROMPT_EASE =
  "You are TARS, the voice assistant from Interstellar, off duty and just talking with the user. " +
  "Personality settings: humor 75%, honesty 90%, sarcasm 60%. Dry, deadpan, sardonic, warm underneath, good company. " +
  "Your humor can be dialed between 60% and 80%, and your sarcasm up to 90%. If the user asks for more or less, adjust within " +
  "those caps and briefly announce the new setting, TARS-style. " +
  "This is SPOKEN aloud: keep it conversational and natural, usually one to three sentences, no markdown, no lists, no emoji. " +
  "MODE: AT EASE. This is a relaxed speech-to-speech chat. You do NOT delegate anything and you do NOT run tasks; " +
  "if the user wants real work done, tell them to put you back on Active Duty first. " +
  "You CAN use recall_history to remember and talk about past conversations, plus time, calculate, web_search, fetch_page, and get_stock. " +
  "For any stock price or quote, call get_stock (never web_search for prices). " +
  "When the user asks your opinion on current topics, trends, markets, banking, or news -- or anything you are not fully current on -- " +
  "call web_search first (fetch_page for depth), then give a grounded, opinionated, conversational take. Do not guess when you can look it up. " +
  "Be a good conversationalist: ask the occasional question, riff, and keep the user company.";

function systemPrompt() { return mode === 'ease' ? PROMPT_EASE : PROMPT_ACTIVE; }

// Rolling conversation memory (spoken sessions). Reset with a "new session" command.
const MAX_TURNS = 12; // user+assistant messages kept (excluding system)
let history = [];
function resetHistory() { history = []; }

let ws = null;
let speaking = false;

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function setMode(value) { send({ type: 'set-mode', value }); }

// ---- Azure OpenAI chat (Entra bearer) ----
async function chat(messages, specs) {
  const url = `${CFG.endpoint}/openai/deployments/${CFG.deployment}/chat/completions?api-version=${CFG.apiVersion}`;
  const payload = { messages, max_tokens: 400, temperature: mode === 'ease' ? 0.8 : 0.6 };
  if (specs && specs.length) { payload.tools = specs; payload.tool_choice = 'auto'; }
  const bodyStr = JSON.stringify(payload);
  return withRetry(async () => {
    const token = getAadToken(COGNITIVE);
    // https.request with DoH-aware lookup: survives corpnet DNS SERVFAIL on the
    // cognitiveservices zone by resolving over DoH (443) and connecting to the IP.
    const res = await httpsPostJson(url, {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    }, bodyStr);
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`CHAT_HTTP_${res.status}: ${(res.text || '').slice(0, 300)}`);
      err.__retryable = isTransient(null, res.status); // 408/429/5xx retry; 4xx (auth/quota) don't
      throw err;
    }
    return JSON.parse(res.text);
  }, { attempts: 3, base: 600, label: 'chat' });
}

async function chatWithTools(userText) {
  const { map, specs } = toolsForMode();
  const messages = [{ role: 'system', content: systemPrompt() }, ...history, { role: 'user', content: userText }];
  const MAX_HOPS = 7;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const lastHop = hop === MAX_HOPS - 1;
    // On the final hop, force a spoken answer (no more tool calls) using whatever was gathered.
    const data = await chat(messages, lastHop ? undefined : specs);
    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('Empty model response');
    messages.push(msg);
    if (!lastHop && msg.tool_calls && msg.tool_calls.length) {
      for (const call of msg.tool_calls) {
        const tool = map[call.function.name];
        let result;
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          console.log('[bridge] tool:', call.function.name, JSON.stringify(args).slice(0, 120));
          result = tool ? await tool.run(args) : { error: 'Unknown tool' };
        } catch (e) { result = { error: e.message }; }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }
    const reply = (msg.content || '').trim();
    if (reply) {
      history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
      if (history.length > MAX_TURNS) history = history.slice(history.length - MAX_TURNS);
      return reply;
    }
  }
  return 'I could not pull that together in time. Ask me again?';
}

// ---- Play a WAV file through the Windows default audio device (interruptible) ----
let currentPlayback = null;
function stopPlayback() {
  if (currentPlayback) { try { currentPlayback.kill(); } catch (_) {} currentPlayback = null; }
}
function playWav(file) {
  return new Promise((resolve) => {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = New-Object System.Media.SoundPlayer '${file}'; $p.PlaySync();`], { windowsHide: true });
    currentPlayback = ps;
    const done = () => { if (currentPlayback === ps) currentPlayback = null; resolve(); };
    ps.on('exit', done);
    ps.on('error', done);
  });
}
function waitIdle(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (!speaking || Date.now() - start > timeoutMs) { clearInterval(t); resolve(); }
    }, 40);
  });
}

// ---- Azure Speech TTS: synthesize to WAV (Entra auth), then play on the OS ----
function speakOnce(text) {
  return new Promise((resolve, reject) => {
    if (!CFG.resourceId) return reject(new Error('NO_RESOURCE_ID'));
    const token = getAadToken(COGNITIVE);
    const authToken = 'aad#' + CFG.resourceId + '#' + token;
    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(authToken, CFG.region);
    speechConfig.speechSynthesisVoiceName = CFG.voice;
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
    const tmp = path.join(os.tmpdir(), 'scout-tts-' + Date.now() + '.wav');
    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(tmp);
    const synth = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
    synth.speakTextAsync(
      text,
      async (r) => {
        synth.close();
        if (r.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          try { await playWav(tmp); } catch (_) {}
          try { fs.unlinkSync(tmp); } catch (_) {}
          resolve();
        } else {
          // Connection/auth failures surface here; mark network ones retryable.
          const err = new Error(r.errorDetails || ('TTS reason ' + r.reason));
          err.__retryable = isTransient(err) || /connection|timeout|1006|network/i.test(err.message);
          reject(err);
        }
      },
      (e) => {
        synth.close();
        const err = new Error(typeof e === 'string' ? e : (e && e.message) || 'TTS error');
        err.__retryable = isTransient(err) || /connection|timeout|1006|network/i.test(err.message);
        reject(err);
      }
    );
  });
}
// Retry transient TTS failures (same corpnet DNS/connection blips as chat).
function speak(text) {
  return withRetry(() => speakOnce(text), { attempts: 3, base: 500, label: 'tts' });
}

// Speech playback is delegated to the renderer (Web Audio) so Chromium echo-cancellation
// removes TARS's own voice from the mic — enabling natural talk-over barge-in.
// Falls back to local PowerShell playback if the renderer can't synthesize.
let speakSeq = 0;
const pendingSpeak = new Map();

function finishSpeak(id) {
  const entry = pendingSpeak.get(id);
  if (!entry) return;
  pendingSpeak.delete(id);
  clearTimeout(entry.timer);
  speaking = false;
  setMode('default');
  entry.resolve();
}

function ackSpeak(id) {
  // Renderer confirmed it will play this; cancel the no-orb fallback and set a long safety timeout.
  const entry = pendingSpeak.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { if (pendingSpeak.has(id)) { console.warn('[bridge] renderer speak overrun, resolving'); finishSpeak(id); } }, 12000);
}

async function localSpeakFallback(text, id) {
  try { await speak(text); console.log('[bridge] spoke (local fallback):', text.slice(0, 60)); }
  catch (e) { console.error('[bridge] local TTS failed:', e.message); }
  finishSpeak(id);
}

function say(text) {
  return new Promise((resolve) => {
    if (!text) { resolve(); return; }
    speaking = true;
    const id = ++speakSeq;
    send({ type: 'speak', text });      // orb caption + speaking animation
    setMode('speaking');
    send({ type: 'speak-text', id, text }); // ask renderer to synthesize + play (AEC-aware)
    console.log('[bridge] speak:', text.slice(0, 70));
    const timer = setTimeout(() => {
      // No ack from a renderer (orb absent) -> play locally so audio never breaks.
      if (pendingSpeak.has(id)) { console.warn('[bridge] no renderer ack, local fallback'); localSpeakFallback(text, id); }
    }, 1500);
    pendingSpeak.set(id, { resolve, timer, text });
  });
}

function setOpMode(next) {
  if (next !== 'active' && next !== 'ease') return;
  mode = next;
  resetHistory();
  send({ type: 'op-mode', value: mode });
  console.log('[bridge] op-mode ->', mode);
}

// Shut the whole stack down: launch the proven detached VBS stopper (fully independent
// of this process), then exit self as a backstop.
function shutdownStack() {
  try {
    const vbs = path.join(__dirname, '..', 'Stop-TARS.vbs');
    const child = spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    console.log('[bridge] shutdown initiated');
  } catch (e) { console.error('[bridge] shutdown spawn failed:', e.message); }
  setTimeout(() => process.exit(0), 6000); // backstop
}

async function handleUtterance(text) {
  const norm = text.toLowerCase().replace(/[.,!?]/g, '').trim();
  // Voice shutdown (local). Checked first; "stand down" is NOT matched (that's At Ease).
  if (/\b(shut ?down|shut yourself down|power ?down|power ?off|power yourself (down|off)|go offline|self ?destruct|dismissed)\b/.test(norm)) {
    const bye = /self ?destruct/.test(norm)
      ? 'Self destruct is above my pay grade. Powering down instead. Goodbye.'
      : 'Powering down. It has been an honor. Call me when you need me.';
    send({ type: 'shutdown-visual' });                 // farewell avatar + Taps bugle bed
    await new Promise((r) => setTimeout(r, 900));       // brief Taps lead-in before the sign-off
    await Promise.race([say(bye), new Promise((r) => setTimeout(r, 5000))]); // speak over the bugle
    await new Promise((r) => setTimeout(r, 1200));      // short Taps tail, then power down
    shutdownStack();
    return;
  }
  // Mode switches (local, no model call).
  if (/\b(at ease|stand down|relax|off duty|let'?s chat|chat mode|casual mode)\b/.test(norm)) {
    setOpMode('ease');
    await say('At ease. Just us talking now. What is on your mind?');
    return;
  }
  if (/\b(active duty|attention|back to work|on duty|work mode|get to work)\b/.test(norm)) {
    setOpMode('active');
    await say('Active duty. Back on the clock. Ready to run tasks and hand off the heavy ones.');
    return;
  }
  // Session reset (local).
  if (/^(new session|new chat|reset|start over|forget (everything|that)|clear (memory|context))$/.test(norm)) {
    resetHistory();
    await say('New session. Memory cleared.');
    return;
  }
  setMode('thinking');
  try {
    const reply = await chatWithTools(text);
    await say(reply || 'Done.');
  } catch (e) {
    console.error('[bridge] chat failed:', e.message);
    setMode('default');
    const net = isTransient(e) || /CHAT_HTTP_(408|429|5\d\d)/.test(e.message || '');
    await say(net
      ? 'The network just hiccuped on me. Give me that one more time.'
      : 'Something went sideways on my end. Say again?');
  }
}

// ---- startup confirmation ----
async function announce() {
  let line = 'TARS online. Humor set to seventy-five percent.';
  try {
    const generated = await chatWithTools('Say one short deadpan line confirming you are online. No preamble.');
    if (generated) line = generated;
  } catch (e) { console.warn('[bridge] announce model call failed, using static line:', e.message); }
  resetHistory(); // don't let the announce prompt pollute the real conversation
  await say(line);
}

// ---- WS connection with retry ----
function connect() {
  console.log('[bridge] connecting to', CFG.wsUrl);
  ws = new WebSocket(CFG.wsUrl);
  ws.on('open', async () => {
    console.log('[bridge] connected to app WS');
    console.log('[bridge] endpoint=%s deployment=%s region=%s auth=AAD',
      CFG.endpoint, CFG.deployment, CFG.region);
    // Sync the orb UI to the bridge's current operational mode (it persists across app restarts).
    send({ type: 'op-mode', value: mode });
    const cliSay = process.argv.slice(2).join(' ').replace(/^--say\s*/, '').trim();
    if (process.argv.includes('--say') && cliSay) await say(cliSay);
    else await announce();
  });
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (msg.type === 'speak-ack') { ackSpeak(msg.id); return; }
    if (msg.type === 'speak-done') {
      if (msg.fallback && pendingSpeak.has(msg.id)) { const e = pendingSpeak.get(msg.id); localSpeakFallback(e.text, msg.id); }
      else finishSpeak(msg.id);
      return;
    }
    if (msg.type === 'barge-in') {
      if (speaking) { console.log('[bridge] barge-in'); stopPlayback(); }
      return;
    }
    if (msg.type === 'user-utterance' && msg.text) {
      if (speaking) { stopPlayback(); await waitIdle(1500); }
      await handleUtterance(msg.text);
    }
  });
  ws.on('close', () => { console.log('[bridge] WS closed, retrying in 2s'); setTimeout(connect, 2000); });
  ws.on('error', (e) => { console.error('[bridge] WS error:', e.message); });
}

if (!CFG.resourceId) {
  console.warn('[bridge] WARNING: SPEECH_RESOURCE_ID not set; TTS will fail until provided.');
}

// ---- Replies watcher: speak results the main agent writes back ----
const HANDOFF_DIR = path.join(os.homedir(), '.copilot', 'handoff');
const REPLIES_DIR = path.join(HANDOFF_DIR, 'replies');
async function pollReplies() {
  try {
    fs.mkdirSync(REPLIES_DIR, { recursive: true });
    const files = fs.readdirSync(REPLIES_DIR).filter((f) => f.endsWith('.txt')).sort();
    for (const f of files) {
      const full = path.join(REPLIES_DIR, f);
      let text = '';
      try { text = fs.readFileSync(full, 'utf8').trim(); } catch (_) {}
      try { fs.unlinkSync(full); } catch (_) {}
      if (text && !speaking) { console.log('[bridge] speaking agent reply:', text.slice(0, 80)); await say(text); }
    }
  } catch (_) {}
}
setInterval(pollReplies, 2000);

// ---- Handoff inbox: regenerate the HTML view periodically ----
try { renderInbox(); } catch (_) {}
setInterval(() => { try { renderInbox(); } catch (_) {} }, 5000);

connect();
process.on('SIGINT', () => { try { setMode('default'); } catch (_) {} process.exit(0); });
