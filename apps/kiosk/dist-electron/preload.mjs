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
electron.contextBridge.exposeInMainWorld("hume", {
  // Start streaming TTS — audio arrives via onAudioChunk events
  speak: (text) => electron.ipcRenderer.invoke("hume:speak", text),
  // Abort the current TTS stream
  stop: () => electron.ipcRenderer.invoke("hume:stop"),
  // Streaming events
  onAudioChunk: (handler) => subscribe("hume:audio-chunk", handler),
  onAudioDone: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("hume:audio-done", listener);
    return () => electron.ipcRenderer.off("hume:audio-done", listener);
  },
  onAudioError: (handler) => subscribe("hume:audio-error", handler)
});
electron.contextBridge.exposeInMainWorld("openclaw", {
  // OpenClaw gateway
  connect: () => electron.ipcRenderer.invoke("openclaw:connect"),
  disconnect: () => electron.ipcRenderer.invoke("openclaw:disconnect"),
  getStatus: () => electron.ipcRenderer.invoke("openclaw:get-status"),
  send: (payload) => electron.ipcRenderer.invoke("openclaw:send", payload),
  onStatus: (handler) => subscribe("openclaw:status", handler),
  onMessage: (handler) => subscribe("openclaw:message", handler),
  // AssemblyAI streaming STT
  startListening: () => electron.ipcRenderer.invoke("openclaw:start-listening"),
  stopListening: () => electron.ipcRenderer.invoke("openclaw:stop-listening"),
  sendAudioChunk: (pcmData) => electron.ipcRenderer.send("openclaw:audio-chunk", pcmData),
  onTranscript: (handler) => subscribe("openclaw:transcript", handler)
});
