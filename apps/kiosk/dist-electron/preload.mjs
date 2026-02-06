"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on: (...args) => electron.ipcRenderer.on(...args),
  off: (...args) => electron.ipcRenderer.off(...args),
  send: (...args) => electron.ipcRenderer.send(...args),
  invoke: (...args) => electron.ipcRenderer.invoke(...args)
});
