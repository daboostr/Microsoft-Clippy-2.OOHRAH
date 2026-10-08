'use strict';
// Per-state visuals: GIF to show, glow color, and animation tempo.
const GIF_DIR = 'orb-gifs/';
const SHUTDOWN_IMG = 'TARS_shutdown.webp';
const GIFS = {
  idle:      'TARS_active.webp',
  active:    'TARS_active.webp',
  ease:      'TARS_ease.webp',
  listening: 'TARS_listening.webp',
  thinking:  'TARS_thinking.webp',
  speaking:  'TARS_speaking.webp'
};
const STATE_STYLE = {
  default:   { glow: 'rgba(58,134,255,0.70)',  c: '#3a86ff', speed: '3.4s' },
  listening: { glow: 'rgba(56,176,0,0.70)',    c: '#38b000', speed: '2.0s' },
  thinking:  { glow: 'rgba(255,190,11,0.70)',  c: '#ffbe0b', speed: '1.4s' },
  speaking:  { glow: 'rgba(255,0,110,0.75)',   c: '#ff006e', speed: '0.9s' },
  ease:      { glow: 'rgba(160,110,255,0.72)', c: '#a06eff', speed: '3.0s' }
};

const halo = document.getElementById('halo');
const tarsImg = document.getElementById('tarsimg');
const caption = document.getElementById('caption');
const statusEl = document.getElementById('status');

let visualMode = 'default';
let shuttingDown = false;

function gifForState(m) {
  if (m === 'speaking') return GIFS.speaking;
  if (m === 'thinking') return GIFS.thinking;
  if (m === 'listening') return GIFS.listening;
  return opMode === 'ease' ? GIFS.ease : GIFS.active; // default/idle depends on op-mode
}
function styleForState(m) {
  if (m === 'speaking' || m === 'thinking' || m === 'listening') return STATE_STYLE[m];
  return opMode === 'ease' ? STATE_STYLE.ease : STATE_STYLE.default;
}
function renderVisual() {
  if (shuttingDown) {
    const src = GIF_DIR + SHUTDOWN_IMG;
    if (tarsImg.getAttribute('data-src') !== src) { tarsImg.setAttribute('data-src', src); tarsImg.src = src; }
    tarsImg.style.clipPath = 'none';   // show the full figure, not a coin crop
    tarsImg.style.setProperty('--glow', 'rgba(255,42,58,0.80)'); // red farewell
    tarsImg.style.setProperty('--speed', '2.2s');
    halo.style.setProperty('--c', '#ff2a3a');
    halo.style.setProperty('--speed', '2.2s');
    return;
  }
  tarsImg.style.clipPath = '';         // restore the circular coin clip for normal states
  const src = GIF_DIR + gifForState(visualMode);
  if (tarsImg.getAttribute('data-src') !== src) { // avoid restarting the GIF when unchanged
    tarsImg.setAttribute('data-src', src);
    tarsImg.src = src;
  }
  const s = styleForState(visualMode);
  tarsImg.style.setProperty('--glow', s.glow);
  tarsImg.style.setProperty('--speed', s.speed);
  halo.style.setProperty('--c', s.c);
  halo.style.setProperty('--speed', s.speed);
}

function applyStyle(mode, text) {
  visualMode = mode;
  renderVisual();
  if (text !== undefined) caption.textContent = text;
}

let liveMode = 'default';
let liveText = '';
let speakEndedAt = 0;
let recentSpoken = '';       // last thing TARS said (for echo rejection after it stops)
function applyState(state) {
  const was = liveMode;
  liveMode = state.mode;
  liveText = state.mode === 'speaking' ? (state.lastText || '') : '';
  if (state.mode === 'speaking' && state.lastText) recentSpoken = state.lastText;
  if (was === 'speaking' && state.mode !== 'speaking') speakEndedAt = Date.now();
  // Marine Corps Hymn bed while TARS is thinking.
  if (state.mode === 'thinking' && was !== 'thinking') playHymnBed();
  else if (was === 'thinking' && state.mode !== 'thinking') stopHymnBed();
  applyStyle(state.mode, state.mode === 'speaking' ? (state.lastText || '') : '');
}

if (window.orbAPI) {
  window.orbAPI.onState(applyState);
  window.orbAPI.onOpMode && window.orbAPI.onOpMode((m) => applyOpMode(m));
  window.orbAPI.onShutdownVisual && window.orbAPI.onShutdownVisual(() => {
    shuttingDown = true;
    renderVisual();
    try { statusEl.textContent = 'powering down…'; } catch (_) {}
    playTapsBed();
  });
  window.orbAPI.getState().then((s) => { if (s) applyState(s); }).catch(() => {});
}

// Play Taps softly as a bugle bed under TARS's shutdown sign-off.
// Tries common web-playable formats; drop a standard file as audio/taps.(mp3|ogg|wav|m4a).
let tapsAudio = null;
const TAPS_SOURCES = ['audio/taps.mp3', 'audio/taps.ogg', 'audio/taps.m4a', 'audio/taps.wav'];
function playTapsBed() {
  let idx = 0;
  const tryNext = () => {
    if (idx >= TAPS_SOURCES.length) { console.error('[orb] no playable Taps source found'); return; }
    const src = TAPS_SOURCES[idx++];
    tapsAudio = new Audio(src);
    tapsAudio.volume = 0.0275;   // gentle, flat bed — no swell
    tapsAudio.addEventListener('error', () => { console.warn('[orb] taps source failed:', src); tryNext(); });
    tapsAudio.addEventListener('playing', () => console.log('[orb] taps playing:', src, 'dur=', tapsAudio.duration));
    tapsAudio.play().catch(() => { /* error listener handles fallback */ });
  };
  tryNext();
}

// Marine Corps Hymn as a low-volume bed while TARS is thinking. Loops, fades out on stop.
let hymnAudio = null;
let hymnFade = null;
function playHymnBed() {
  try {
    if (hymnFade) { clearInterval(hymnFade); hymnFade = null; }
    if (hymnAudio) { try { hymnAudio.pause(); } catch (_) {} hymnAudio = null; }
    hymnAudio = new Audio('audio/hymn.wav');
    hymnAudio.loop = true;
    hymnAudio.volume = 0.05;   // low background bed
    hymnAudio.addEventListener('error', () => console.warn('[orb] hymn load failed'));
    hymnAudio.play().catch(() => {});
  } catch (_) {}
}
function stopHymnBed() {
  if (!hymnAudio) return;
  const a = hymnAudio; hymnAudio = null;
  if (hymnFade) clearInterval(hymnFade);
  hymnFade = setInterval(() => {
    if (a.volume > 0.006) { a.volume = Math.max(0, a.volume - 0.006); }
    else { clearInterval(hymnFade); hymnFade = null; try { a.pause(); } catch (_) {} }
  }, 40);
}

let opMode = 'active';
function applyOpMode(m) {
  opMode = (m === 'ease') ? 'ease' : 'active';
  const el = document.getElementById('mode');
  if (el) {
    el.textContent = opMode === 'ease' ? 'AT EASE' : 'ACTIVE DUTY';
    el.className = opMode;
  }
  // At Ease is an open-mic conversation; Active Duty needs the wake word.
  if (opMode === 'ease') { awake = false; clearTimeout(wakeTimer); setStatus('At Ease — just talk'); }
  else { awake = false; setStatus('say "TARS" to wake'); }
  renderVisual(); // swap idle GIF between active-duty and at-ease
}

// ---------- Microphone + wake-word STT ----------
const WAKE_NAME = 'tars';
const WAKE_RE = /\b(tars|tar's|tarz|tarse|tarr)\b/i;
const WAKE_WINDOW_MS = 12000;
let awake = false;
let wakeTimer = null;
let recognizer = null;

// --- Active Duty command accumulation + "Copy" terminator ---
// A spoken command is buffered across recognized segments so stutters/pauses
// don't trigger a premature delegate. Close a command explicitly with "Copy"
// (radio style — say it alone after a beat) and TARS acks "Copy." and runs it.
// If you don't say the terminator, a fallback timer dispatches after some silence.
// Safe matching: a STANDALONE "copy"/"over" segment, or the distinctive
// "copy that"/"how copy" trailing — so real content like "send Ali a copy" or
// "is the meeting over" is NOT mistaken for a terminator.
const COPY_STANDALONE = /^(copy|copy that|how copy|over|out)\s*[.?!]*$/i;
const COPY_TRAILING = /\b(copy that|how copy)\s*[.?!]*$/i;
const COPY_STRIP = /\s*\b(copy that|how copy|copy|over|out)\s*[.?!]*$/i;
function isCopyTerminator(seg) { const s = seg.trim(); return COPY_STANDALONE.test(s) || COPY_TRAILING.test(s); }
function stripCopy(seg) { return seg.replace(COPY_STRIP, '').trim(); }
const COPY_ACK = 'Copy.';
const CMD_FALLBACK_MS = 3500; // dispatch the buffer after this much post-segment silence
let cmdBuffer = [];
let cmdTimer = null;
function resetCmd() { cmdBuffer = []; clearTimeout(cmdTimer); cmdTimer = null; }
function flushCmd() {
  const full = cmdBuffer.join(' ').replace(/\s+/g, ' ').trim();
  resetCmd();
  if (full) dispatch(full);
}

function setStatus(t) { statusEl.textContent = t; }

function stripWake(text) {
  return text.replace(/^[\s,.!:;-]*\b(tars|tar's|tarz|tarse|tarr)\b[\s,.!:;-]*/i, '').trim();
}

// Barge-in: require the wake word (or a clear stop command) so TARS's own
// speaker audio can never self-trigger an interruption.
// Tier 2 (strict barge-in): while TARS is speaking, ONLY the wake word
// interrupts him — a bystander talking over him won't cut him off. Set to
// false to allow any 2+ word utterance to interrupt (old talk-over behavior).
const STRICT_BARGE_IN = true;
// Dedicated interrupt phrase (distinct from the wake word) to cut TARS off
// mid-speech: "TARS, ears" (or just "ears"). He acks with "Open, sir" and
// drops straight into listening mode.
const EARS_RE = /\bears\b/i;
const EARS_ACK = 'Open, sir.';
const STOP_RE = /\b(stop|quiet|shut up|shush|hush|enough|cancel|never ?mind|be quiet)\b/i;
const ECHO_COOLDOWN_MS = 1200; // ignore input briefly after speech ends (trailing echo)
const ECHO_WINDOW_MS = 4000;   // within this window after speaking, reject echo-like phrases
function wordsOf(s) { return (String(s).toLowerCase().match(/[a-z0-9]+/g) || []); }
function overlap(text, reference) {
  const a = wordsOf(text); if (!a.length) return 1;
  const b = new Set(wordsOf(reference));
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  return inter / a.length;
}
function echoOfCurrent(text) {
  // Is this recognized phrase mostly TARS's own currently-playing speech?
  return !!liveText && overlap(text, liveText) >= 0.5;
}
function looksLikeEcho(text) {
  if (!recentSpoken || Date.now() - speakEndedAt > ECHO_WINDOW_MS) return false;
  return overlap(text, recentSpoken) >= 0.6; // most words echo what TARS just said
}

function goAwake() {
  awake = true;
  resetCmd();
  applyStyle('listening', 'Listening...');
  setStatus('listening — say "Copy" when done');
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    awake = false;
    applyStyle('default', '');
    setStatus('say "TARS" to wake');
    resetCmd();
  }, WAKE_WINDOW_MS);
}

function handleRecognized(text) {
  // --- Dedicated interrupt phrase: "TARS, ears" (or "ears") ---
  // Works whether TARS is still speaking or the interim handler already barged
  // in (speech just stopped) — then ack "Open, sir" and drop into listening.
  if (EARS_RE.test(text) && (liveMode === 'speaking' || Date.now() - speakEndedAt < 1800)) {
    doBargeIn();
    recentSpoken = EARS_ACK; speakEndedAt = Date.now(); // so his own ack isn't heard as a command
    speakLocalLine(EARS_ACK);
    goAwake();
    return;
  }
  // Drop TARS's own "Open, sir" / "Copy." acks if the mic catches them right after.
  if (Date.now() - speakEndedAt < 2500 && (overlap(text, EARS_ACK) >= 0.5 || overlap(text, COPY_ACK) >= 0.5)) return;

  // --- Barge-in: TARS is currently speaking ---
  if (liveMode === 'speaking') {
    if (echoOfCurrent(text)) return; // AEC backstop: ignore TARS's own leaked voice
    const twoPlus = text.trim().split(/\s+/).length >= 2;
    const hasWake = WAKE_RE.test(text);
    const hasStop = STOP_RE.test(text);

    // Tier 2: in strict mode, only the wake word interrupts — bystanders talking
    // (even full sentences) are ignored so they can't hijack or cut off TARS.
    // Applied on Active Duty (demos/commands); At Ease keeps natural talk-over.
    if (STRICT_BARGE_IN && opMode === 'active') {
      if (!hasWake) return;
    } else if (!twoPlus && !hasWake && !hasStop) {
      return; // ignore tiny fragments
    }
    doBargeIn();
    const afterWake = hasWake ? stripWake(text) : text.trim();
    const residual = afterWake.replace(STOP_RE, '').trim();
    if (hasStop && residual.length < 3) return; // pure "stop" -> just silence
    if (afterWake) dispatch(afterWake);
    return;
  }
  // --- Cooldown right after speaking: drop trailing echo ---
  if (Date.now() - speakEndedAt < ECHO_COOLDOWN_MS) return;

  // --- AT EASE: open-mic conversation, no wake word needed between turns ---
  if (opMode === 'ease') {
    if (looksLikeEcho(text)) return;
    const cmd = WAKE_RE.test(text) ? stripWake(text) : text.trim();
    if (cmd) dispatch(cmd);
    return;
  }

  // --- ACTIVE DUTY: wake-word gated ---
  if (!awake) {
    if (WAKE_RE.test(text)) {
      const after = stripWake(text);
      resetCmd();
      if (after) {
        // Wake + command in one breath. If it also closes with "Copy", run now.
        if (isCopyTerminator(after)) { const c = stripCopy(after); if (c) cmdBuffer.push(c); speakLocalLine(COPY_ACK); flushCmd(); }
        else { cmdBuffer.push(after); armCmdTimer(); }
      } else goAwake();
    }
    return;
  }
  // Already awake: accumulate this segment; "Copy" closes and runs the command.
  const seg = stripWake(text).trim();
  if (!seg) return;
  if (isCopyTerminator(seg)) {
    const c = stripCopy(seg);
    if (c) cmdBuffer.push(c);
    clearTimeout(wakeTimer);
    speakLocalLine(COPY_ACK);
    flushCmd();
    return;
  }
  cmdBuffer.push(seg);
  armCmdTimer();
}

// Keep the awake window alive while buffering, and dispatch after a pause if the
// user never says the terminator (so quick commands still work hands-free).
function armCmdTimer() {
  awake = true;
  applyStyle('listening', 'Listening...');
  setStatus('listening — say "Copy" when done');
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => { awake = false; applyStyle('default', ''); setStatus('say "TARS" to wake'); resetCmd(); }, WAKE_WINDOW_MS);
  clearTimeout(cmdTimer);
  cmdTimer = setTimeout(flushCmd, CMD_FALLBACK_MS);
}

function dispatch(cmd) {
  awake = false;
  clearTimeout(wakeTimer);
  resetCmd();
  recentSpoken = COPY_ACK; speakEndedAt = Date.now(); // so TARS's own "Copy." ack isn't re-heard as a command
  applyStyle('thinking', '');
  setStatus('heard: ' + cmd);
  window.orbAPI.sendUtterance(cmd);
}

// ---------- Renderer-side TTS playback (Web Audio => Chromium echo-cancellation) ----------
let lastCreds = null;
let speechVoice = 'en-US-DavisNeural';
let currentSpeak = null;

function stopCurrentSpeech(notify) {
  const cur = currentSpeak;
  if (!cur) return;
  currentSpeak = null;
  try { if (cur.player) cur.player.pause(); } catch (_) {}
  try { if (cur.player) cur.player.close(); } catch (_) {}
  try { if (cur.synth) cur.synth.close(); } catch (_) {}
  if (notify && !cur.done) { cur.done = true; try { window.orbAPI.speakDone(cur.id, false); } catch (_) {} }
}

function speakText(id, text) {
  stopCurrentSpeech(false); // supersede anything still playing
  if (!window.SpeechSDK || !lastCreds || !lastCreds.authToken) {
    try { window.orbAPI.speakDone(id, true); } catch (_) {} // ask bridge to play locally
    return;
  }
  try {
    const sc = window.SpeechSDK.SpeechConfig.fromAuthorizationToken(lastCreds.authToken, lastCreds.region);
    sc.speechSynthesisVoiceName = speechVoice;
    try { window.orbAPI.speakAck(id); } catch (_) {} // tell bridge we've got this (cancel its fallback)
    const player = new window.SpeechSDK.SpeakerAudioDestination();
    const audioConfig = window.SpeechSDK.AudioConfig.fromSpeakerOutput(player);
    const synth = new window.SpeechSDK.SpeechSynthesizer(sc, audioConfig);
    const cur = { id, synth, player, done: false };
    currentSpeak = cur;
    const done = (fallback) => {
      if (cur.done) return; cur.done = true;
      if (currentSpeak === cur) currentSpeak = null;
      try { synth.close(); } catch (_) {}
      try { window.orbAPI.speakDone(id, !!fallback); } catch (_) {}
    };
    player.onAudioEnd = () => done(false);
    synth.speakTextAsync(text,
      (result) => { if (result.reason !== window.SpeechSDK.ResultReason.SynthesizingAudioCompleted) done(true); },
      (_err) => done(true)
    );
  } catch (_) {
    try { window.orbAPI.speakDone(id, true); } catch (_) {}
  }
}

// Speak a short local line (e.g. the "Open, sir" interrupt ack) without going
// through the bridge's speak queue — fire-and-forget through the same SDK path.
function speakLocalLine(text) {
  try {
    if (!window.SpeechSDK || !lastCreds || !lastCreds.authToken) return;
    const sc = window.SpeechSDK.SpeechConfig.fromAuthorizationToken(lastCreds.authToken, lastCreds.region);
    sc.speechSynthesisVoiceName = speechVoice;
    const player = new window.SpeechSDK.SpeakerAudioDestination();
    const audioConfig = window.SpeechSDK.AudioConfig.fromSpeakerOutput(player);
    const synth = new window.SpeechSDK.SpeechSynthesizer(sc, audioConfig);
    player.onAudioEnd = () => { try { synth.close(); } catch (_) {} };
    synth.speakTextAsync(text, () => {}, () => { try { synth.close(); } catch (_) {} });
  } catch (_) {}
}

function doBargeIn() {
  stopCurrentSpeech(true);          // stop renderer audio + tell bridge we're done
  try { window.orbAPI.bargeIn(); } catch (_) {} // stop any bridge-side fallback playback
  setStatus('interrupted');
}

// ---- Tier 1 voice isolation: capture the mic with aggressive ambient
// suppression so bystanders / room noise are filtered before recognition.
async function getIsolatedMicStream() {
  const base = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    // Chromium-specific "goog" hints for stronger isolation/voice-focus.
    googEchoCancellation: true,
    googNoiseSuppression: true,
    googNoiseSuppression2: true,
    googAutoGainControl: true,
    googHighpassFilter: true,
    googExperimentalNoiseSuppression: true,
    googExperimentalEchoCancellation: true,
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: base, video: false });
  } catch (_) {
    // Fallback to the three standard constraints if goog hints are rejected.
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
      });
    } catch (e2) { return null; }
  }
}

async function startMic() {
  if (!window.SpeechSDK) { setStatus('speech sdk failed to load'); return; }
  let creds = null;
  try { creds = await window.orbAPI.getSpeechToken(); } catch (_) {}
  if (!creds || !creds.authToken) { setStatus('no speech token (az login?)'); return; }
  lastCreds = creds;
  if (creds.voice) speechVoice = creds.voice;

  const speechConfig = window.SpeechSDK.SpeechConfig.fromAuthorizationToken(creds.authToken, creds.region);
  speechConfig.speechRecognitionLanguage = 'en-US';
  // Tolerate stutters / sub-second pauses: don't finalize a phrase until ~1.5s of
  // silence (default is ~0.5s, which cut the user off mid-thought).
  try { speechConfig.setProperty(window.SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, '1500'); } catch (_) {}
  // Tier 1: feed a noise-suppressed MediaStream instead of the raw default mic.
  const isolatedStream = await getIsolatedMicStream();
  const audioConfig = isolatedStream
    ? window.SpeechSDK.AudioConfig.fromStreamInput(isolatedStream)
    : window.SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  recognizer = new window.SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_s, e) => {
    // Interim results: cut TARS off the instant the user starts talking over it.
    if (liveMode !== 'speaking') return;
    const txt = (e.result && e.result.text || '').trim();
    if (!txt || echoOfCurrent(txt)) return;
    // The dedicated interrupt phrase cuts in immediately (handleRecognized does the ack).
    if (EARS_RE.test(txt)) { doBargeIn(); return; }
    // Tier 2: strict barge-in only reacts to the wake word mid-speech (Active Duty).
    if (STRICT_BARGE_IN && opMode === 'active') {
      if (WAKE_RE.test(txt)) doBargeIn();
      return;
    }
    if (txt.split(/\s+/).length >= 2 || WAKE_RE.test(txt) || STOP_RE.test(txt)) doBargeIn();
  };
  recognizer.recognized = (_s, e) => {
    if (e.result && e.result.reason === window.SpeechSDK.ResultReason.RecognizedSpeech) {
      const txt = (e.result.text || '').trim();
      if (txt) handleRecognized(txt);
    }
  };
  recognizer.canceled = (_s, e) => { setStatus('mic canceled: ' + (e.errorDetails || e.reason)); };
  recognizer.sessionStopped = () => { setStatus('mic stopped'); };

  recognizer.startContinuousRecognitionAsync(
    () => { setStatus('say "TARS" to wake'); },
    (err) => { setStatus('mic start error: ' + err); }
  );

  setInterval(async () => {
    try {
      const c = await window.orbAPI.getSpeechToken();
      if (c && c.authToken) { lastCreds = c; if (recognizer) recognizer.authorizationToken = c.authToken; }
    } catch (_) {}
  }, 8 * 60 * 1000);
}

window.addEventListener('DOMContentLoaded', () => {
  startMic();
  setupControls();
  if (window.orbAPI && window.orbAPI.onSpeakText) {
    window.orbAPI.onSpeakText((p) => { if (p) speakText(p.id, p.text); });
  }
});

// ---------- Control bar: click-through toggle, drag, mute, minimize, quit ----------
let micMuted = false;

function setupControls() {
  const bar = document.getElementById('bar');
  const muteBtn = document.getElementById('mute');
  const minBtn = document.getElementById('min');
  const closeBtn = document.getElementById('close');
  const dragEl = document.getElementById('drag');

  // Toggle OS click-through: capture the mouse only while hovering the control bar.
  let interactive = false;
  function setInteractive(v) {
    if (v === interactive) return;
    interactive = v;
    try { window.orbAPI.setInteractive(v); } catch (_) {}
  }
  window.addEventListener('mousemove', (e) => {
    if (dragging) return; // keep interactive during drag
    const el = document.elementFromPoint(e.clientX, e.clientY);
    setInteractive(!!(el && el.closest('#bar')));
  });
  window.addEventListener('mouseleave', () => { if (!dragging) setInteractive(false); });

  // Manual window drag via the grip handle.
  let dragging = false;
  dragEl.addEventListener('mousedown', (e) => {
    dragging = true; dragEl.style.cursor = 'grabbing';
    try { window.orbAPI.setInteractive(true); } catch (_) {}
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (dragging && (e.movementX || e.movementY)) {
      try { window.orbAPI.move(e.movementX, e.movementY); } catch (_) {}
    }
  });
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; dragEl.style.cursor = 'grab'; }
  });

  muteBtn.addEventListener('click', () => {
    micMuted = !micMuted;
    muteBtn.classList.toggle('muted', micMuted);
    muteBtn.textContent = micMuted ? '🔇' : '🎙';
    if (!recognizer) return;
    if (micMuted) {
      recognizer.stopContinuousRecognitionAsync(() => setStatus('mic muted'), () => {});
    } else {
      recognizer.startContinuousRecognitionAsync(() => setStatus('say "TARS" to wake'), () => {});
    }
  });
  minBtn.addEventListener('click', () => { try { window.orbAPI.minimize(); } catch (_) {} });
  closeBtn.addEventListener('click', () => { try { window.orbAPI.quit(); } catch (_) {} });
}
