'use strict';
// Generic preload (reserved for a future main window). Intentionally minimal.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('scout', { app: 'clawpilot-voice' });
