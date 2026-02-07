"use strict";
const electron = require("electron");
function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.off(channel, listener);
}
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on: (...args) => electron.ipcRenderer.on(...args),
  off: (...args) => electron.ipcRenderer.off(...args),
  send: (...args) => electron.ipcRenderer.send(...args),
  invoke: (...args) => electron.ipcRenderer.invoke(...args)
});
electron.contextBridge.exposeInMainWorld("openclaw", {
  connect: () => electron.ipcRenderer.invoke("openclaw:connect"),
  disconnect: () => electron.ipcRenderer.invoke("openclaw:disconnect"),
  getStatus: () => electron.ipcRenderer.invoke("openclaw:get-status"),
  send: (payload) => electron.ipcRenderer.invoke("openclaw:send", payload),
  onStatus: (handler) => subscribe("openclaw:status", handler),
  onMessage: (handler) => subscribe("openclaw:message", handler)
});
