import { ipcRenderer, contextBridge } from "electron";

type PicoclawStatusPayload = {
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string | null;
};

type PicoclawMessagePayload = {
  direction: "in" | "out" | "system";
  data: string;
  ts: number;
};

function subscribe<T>(
  channel: string,
  handler: (payload: T) => void,
): () => void {
  const listener = (
    _event: Electron.IpcRendererEvent,
    payload: T,
  ) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

contextBridge.exposeInMainWorld("hume", {
  speak: (text: string) =>
    ipcRenderer.invoke("hume:speak", text) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  stop: () => ipcRenderer.invoke("hume:stop") as Promise<{ ok: boolean }>,
  onAudioChunk: (handler: (audioBase64: string) => void) =>
    subscribe<string>("hume:audio-chunk", handler),
  onAudioDone: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("hume:audio-done", listener);
    return () => ipcRenderer.off("hume:audio-done", listener);
  },
  onAudioError: (handler: (error: string) => void) =>
    subscribe<string>("hume:audio-error", handler),
});

contextBridge.exposeInMainWorld("picoclaw", {
  connect: () =>
    ipcRenderer.invoke("picoclaw:connect") as Promise<PicoclawStatusPayload>,
  disconnect: () =>
    ipcRenderer.invoke("picoclaw:disconnect") as Promise<PicoclawStatusPayload>,
  getStatus: () =>
    ipcRenderer.invoke("picoclaw:get-status") as Promise<PicoclawStatusPayload>,
  send: (payload: unknown) =>
    ipcRenderer.invoke("picoclaw:send", payload) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  onStatus: (handler: (payload: PicoclawStatusPayload) => void) =>
    subscribe<PicoclawStatusPayload>("picoclaw:status", handler),
  onMessage: (handler: (payload: PicoclawMessagePayload) => void) =>
    subscribe<PicoclawMessagePayload>("picoclaw:message", handler),

  // AssemblyAI streaming STT
  startListening: () =>
    ipcRenderer.invoke("picoclaw:start-listening") as Promise<{
      ok: boolean;
      error?: string;
    }>,
  stopListening: () =>
    ipcRenderer.invoke("picoclaw:stop-listening") as Promise<{
      ok: boolean;
      error?: string;
    }>,
  sendAudioChunk: (pcmData: ArrayBuffer) =>
    ipcRenderer.send("picoclaw:audio-chunk", pcmData),
  onTranscript: (handler: (text: string) => void) =>
    subscribe<string>("picoclaw:transcript", handler),
});

contextBridge.exposeInMainWorld("motors", {
  command: (cmd: Record<string, unknown>) =>
    ipcRenderer.invoke("motors:command", cmd) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  setEmotion: (emotion: string) =>
    ipcRenderer.invoke("motors:set-emotion", emotion) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  stop: () =>
    ipcRenderer.invoke("motors:stop") as Promise<{
      ok: boolean;
      error?: string;
    }>,
  setServos: (angle1: number, angle2: number) =>
    ipcRenderer.invoke("motors:set-servos", angle1, angle2) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  onStatus: (
    handler: (status: {
      type: string;
      status: string;
      message: string;
    }) => void,
  ) =>
    subscribe<{ type: string; status: string; message: string }>(
      "motors:status",
      handler,
    ),
});
