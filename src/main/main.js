'use strict';
const { app, BrowserWindow, ipcMain, screen, session, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');

const WS_PORT = 8765;
const VALID_MODES = ['default', 'listening', 'thinking', 'speaking'];

// Load scout-voice/.env so SPEECH_* are available to the token handler.
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) {}
})();

const SPEECH_REGION = process.env.SPEECH_REGION || 'eastus2';
const SPEECH_RESOURCE_ID = process.env.SPEECH_RESOURCE_ID || '';
const SPEECH_VOICE = process.env.SPEECH_VOICE || 'en-US-DavisNeural';

const stateDir = path.join(app.getPath('appData'), 'clawpilot-voice');
const stateFile = path.join(stateDir, 'orb-state.json');

let orbWin = null;
let wss = null;
let tray = null;
let lastOpMode = 'active';
let state = { mode: 'default', lastText: '', queue: [], updatedAt: new Date().toISOString() };

function ensureStateDir() {
  try { fs.mkdirSync(stateDir, { recursive: true }); } catch (_) {}
}

function persistState() {
  state.updatedAt = new Date().toISOString();
  try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch (e) { console.error('[main] persist failed', e.message); }
}

function broadcast() {
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('orb:state', state);
  if (wss) {
    const msg = JSON.stringify({ type: 'state', state });
    for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(msg); } catch (_) {} } }
  }
}

function setMode(value) {
  if (!VALID_MODES.includes(value)) { console.warn('[main] ignoring unknown mode', value); return; }
  state.mode = value;
  persistState();
  broadcast();
  console.log('[main] mode ->', value);
}

function handleMessage(raw, sender) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
  switch (msg.type) {
    case 'set-mode':
      setMode(msg.value);
      break;
    case 'speak':
      state.lastText = String(msg.text || '');
      setMode('speaking');
      break;
    case 'op-mode':
      // Operational mode (Active Duty / At Ease) from the bridge -> forward to orb UI.
      lastOpMode = msg.value;
      if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('orb:op-mode', msg.value);
      break;
    case 'shutdown-visual':
      // Bridge is powering the stack down -> show the farewell avatar.
      if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('orb:shutdown-visual');
      break;
    case 'user-utterance':
      // Relay utterances from UI/mic clients to the bridge (and any other clients).
      if (wss) {
        const m = JSON.stringify(msg);
        for (const c of wss.clients) { if (c !== sender && c.readyState === 1) { try { c.send(m); } catch (_) {} } }
      }
      break;
    case 'speak-text':
      // Bridge asks the renderer to synthesize + play this text (AEC-aware playback).
      if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send('orb:speak-text', { id: msg.id, text: msg.text });
      break;
    case 'get-state':
      return { type: 'state', state };
    case 'ping':
      return { type: 'pong', t: Date.now() };
    default:
      console.warn('[main] unknown message type', msg.type);
  }
  return null;
}

function startWsServer() {
  wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });
  wss.on('listening', () => console.log('[main] WS listening on 127.0.0.1:' + WS_PORT));
  wss.on('error', (e) => console.error('[main] WS error', e.message));
  wss.on('connection', (socket) => {
    console.log('[main] client connected');
    try { socket.send(JSON.stringify({ type: 'state', state })); } catch (_) {}
    socket.on('message', (raw) => {
      const reply = handleMessage(raw, socket);
      if (reply && socket.readyState === 1) { try { socket.send(JSON.stringify(reply)); } catch (_) {} }
    });
    socket.on('close', () => console.log('[main] client disconnected'));
  });
}

function createOrbWindow() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  const size = 240;
  orbWin = new BrowserWindow({
    width: size,
    height: size + 96,
    x: width - size - 32,
    y: height - size - 128,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'orb-preload', 'orb-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  orbWin.setAlwaysOnTop(true, 'screen-saver');
  // Click-through by default; renderer toggles this off while hovering controls.
  orbWin.setIgnoreMouseEvents(true, { forward: true });
  orbWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  orbWin.once('ready-to-show', () => { broadcast(); });
  orbWin.webContents.on('did-finish-load', () => {
    orbWin.webContents.send('orb:op-mode', lastOpMode);
  });
}

// Toggle click-through. interactive=true -> capture mouse (controls); false -> pass clicks through.
ipcMain.on('orb:set-interactive', (_e, interactive) => {
  if (orbWin && !orbWin.isDestroyed()) {
    orbWin.setIgnoreMouseEvents(!interactive, { forward: true });
  }
});
ipcMain.on('orb:minimize', () => { if (orbWin && !orbWin.isDestroyed()) orbWin.hide(); });
ipcMain.on('orb:quit', () => { app.quit(); });
ipcMain.on('orb:move', (_e, dx, dy) => {
  if (orbWin && !orbWin.isDestroyed()) {
    const [x, y] = orbWin.getPosition();
    orbWin.setPosition(Math.round(x + dx), Math.round(y + dy));
  }
});
// Renderer finished (or aborted) speaking -> tell the bridge to continue.
ipcMain.on('orb:speak-done', (_e, payload) => {
  if (!wss) return;
  const m = JSON.stringify({ type: 'speak-done', id: payload && payload.id, fallback: !!(payload && payload.fallback) });
  for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(m); } catch (_) {} } }
});
// Renderer confirms it will handle playback -> bridge cancels its no-orb fallback.
ipcMain.on('orb:speak-ack', (_e, id) => {
  if (!wss) return;
  const m = JSON.stringify({ type: 'speak-ack', id });
  for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(m); } catch (_) {} } }
});

function showOrb() {
  if (!orbWin || orbWin.isDestroyed()) { createOrbWindow(); return; }
  orbWin.show();
  orbWin.setAlwaysOnTop(true, 'screen-saver');
}
function toggleOrbVisibility() {
  if (!orbWin || orbWin.isDestroyed()) { createOrbWindow(); return; }
  if (orbWin.isVisible()) orbWin.hide();
  else showOrb();
}

function buildTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'resources', 'tray.png'));
  if (icon.isEmpty()) {
    // Fallback 1x1 so Windows still shows a tray entry.
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  }
  tray = new Tray(icon);
  tray.setToolTip('TARS voice orb');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide orb', click: toggleOrbVisibility },
    { label: 'Restore (Ctrl+Shift+Space)', click: showOrb },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleOrbVisibility);
  tray.on('double-click', showOrb);
}

ipcMain.handle('orb:get-state', () => state);

// Renderer STT -> relay to bridge over WS as a user utterance.
function broadcastUtterance(text) {
  if (!wss) return;
  const m = JSON.stringify({ type: 'user-utterance', text });
  for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(m); } catch (_) {} } }
}
ipcMain.on('orb:utterance', (_e, text) => {
  const t = String(text || '').trim();
  if (t) { console.log('[main] utterance from mic:', t); broadcastUtterance(t); }
});
ipcMain.on('orb:barge-in', () => {
  if (!wss) return;
  const m = JSON.stringify({ type: 'barge-in' });
  for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(m); } catch (_) {} } }
});

// Mint an AAD-based Speech authorization token for the renderer SDK.
ipcMain.handle('orb:speech-token', async () => {
  return new Promise((resolve) => {
    execFile('az', ['account', 'get-access-token', '--resource',
      'https://cognitiveservices.azure.com', '--query', 'accessToken', '-o', 'tsv'],
      { shell: true, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) { resolve(null); return; }
        const token = stdout.trim();
        resolve({ authToken: 'aad#' + SPEECH_RESOURCE_ID + '#' + token, region: SPEECH_REGION, voice: SPEECH_VOICE });
      });
  });
});

app.whenReady().then(() => {
  // Auto-grant microphone to our own renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'microphone');
  });
  ensureStateDir();
  state.mode = 'default';
  persistState();
  startWsServer();
  createOrbWindow();
  buildTray();
  // Global hotkey to show/hide the orb (useful after minimize).
  try { globalShortcut.register('CommandOrControl+Shift+Space', toggleOrbVisibility); } catch (_) {}
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createOrbWindow(); });
});

app.on('window-all-closed', () => { /* keep alive as a tray-less background orb host */ });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (_) {} });
app.on('before-quit', () => { try { if (wss) wss.close(); } catch (_) {} });
