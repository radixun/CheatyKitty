import { contextBridge, ipcRenderer } from "electron";
import type { CodexDiagnostic, CodexTestResult, Settings } from "./types";

contextBridge.exposeInMainWorld("cheatykitty", {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Settings): Promise<Settings> => ipcRenderer.invoke("settings:save", settings),
  previewOpacity: (opacity: number): Promise<void> => ipcRenderer.invoke("settings:preview-opacity", opacity),
  onOpacity: (callback: (opacity: number) => void): void => {
    ipcRenderer.removeAllListeners("overlay:opacity");
    ipcRenderer.on("overlay:opacity", (_event, opacity) => callback(opacity));
  },
  openSettings: (): void => ipcRenderer.send("settings:open"),
  closeSettings: (): void => ipcRenderer.send("settings:close"),
  quit: (): void => ipcRenderer.send("app:quit"),
  validateShortcut: (shortcut: string): Promise<unknown> => ipcRenderer.invoke("shortcut:validate", shortcut),
  startShortcutRecording: (): Promise<unknown> => ipcRenderer.invoke("shortcut:recording-start"),
  checkShortcutCandidate: (shortcut: string): Promise<unknown> => ipcRenderer.invoke("shortcut:recording-check", shortcut),
  stopShortcutRecording: (reason: string): Promise<unknown> => ipcRenderer.invoke("shortcut:recording-stop", reason),
  retryShortcut: (): Promise<unknown> => ipcRenderer.invoke("shortcut:retry"),
  chooseCodex: (): Promise<string | null> => ipcRenderer.invoke("codex:choose"),
  inspectCodex: (customPath: string): Promise<CodexDiagnostic> => ipcRenderer.invoke("codex:inspect", customPath),
  listModels: (customPath: string) => ipcRenderer.invoke("codex:models", customPath),
  testCodex: (customPath: string, model: Settings["model"], reasoningEffort: Settings["reasoningEffort"], fastMode: boolean): Promise<CodexTestResult> => ipcRenderer.invoke("codex:test", customPath, model, reasoningEffort, fastMode),
  cancel: (): void => ipcRenderer.send("codex:cancel"),
  setHitRegions: (regions: unknown): void => ipcRenderer.send("overlay:hit-regions", regions),
  clearHitRegions: (): void => ipcRenderer.send("overlay:clear-hit-regions"),
  resizeMain: (height: number): Promise<void> => ipcRenderer.invoke("overlay:content-height", height),
  onState: (callback: (state: unknown) => void): void => {
    ipcRenderer.removeAllListeners("overlay:state");
    ipcRenderer.on("overlay:state", (_event, state) => callback(state));
  },
  onSelectionImage: (callback: (payload: unknown) => void): void => {
    ipcRenderer.removeAllListeners("selection:image");
    ipcRenderer.on("selection:image", (_event, payload) => callback(payload));
  },
  selectArea: (rect: unknown): Promise<void> => ipcRenderer.invoke("selection:complete", rect),
  cancelSelection: (): Promise<void> => ipcRenderer.invoke("selection:cancel")
});
