'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbAPI', {
  onState: (cb) => ipcRenderer.on('orb:state', (_e, state) => cb(state)),
  onOpMode: (cb) => ipcRenderer.on('orb:op-mode', (_e, m) => cb(m)),
  onShutdownVisual: (cb) => ipcRenderer.on('orb:shutdown-visual', () => cb()),
  getState: () => ipcRenderer.invoke('orb:get-state'),
  getSpeechToken: () => ipcRenderer.invoke('orb:speech-token'),
  sendUtterance: (text) => ipcRenderer.send('orb:utterance', text),
  bargeIn: () => ipcRenderer.send('orb:barge-in'),
  onSpeakText: (cb) => ipcRenderer.on('orb:speak-text', (_e, p) => cb(p)),
  speakDone: (id, fallback) => ipcRenderer.send('orb:speak-done', { id, fallback: !!fallback }),
  speakAck: (id) => ipcRenderer.send('orb:speak-ack', id),
  setInteractive: (v) => ipcRenderer.send('orb:set-interactive', v),
  minimize: () => ipcRenderer.send('orb:minimize'),
  quit: () => ipcRenderer.send('orb:quit'),
  move: (dx, dy) => ipcRenderer.send('orb:move', dx, dy)
});
