import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen } from "electron";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { appendFile, writeFile } from "node:fs/promises";
import { cancelCodex, inspectCodex, preflightCodex, runCodex, testCodex } from "./codex";
import { loadSettingsWithFallback, sanitizeOpacity, saveSettings } from "./settings";
import type { OverlayState, Settings } from "./types";
import { PointerRegionTracker, shouldIgnoreMainMouseEvents, type HitRegions, type PointerRegion, type RegionRect } from "./click-through";
import { AutoCaptureScheduler } from "./auto-scheduler";
import { shortcutLabel, stageShortcutRegistration, transactShortcutRegistration, validateHotkey } from "./hotkey";
import { DEFAULT_SETTINGS } from "./settings";
import { commitCurrentResult, isCompleteResult } from "./result-state";
import { listCodexModels, type CatalogModel } from "./model-catalog";
import { modelLabel as selectedModelLabel } from "./model-options";
import { runCaptureHelper, terminateCaptureHelper } from "./capture-process";

const UI_FEEDBACK_MS = 120;
let overlay: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let selectionWindow: BrowserWindow | null = null;
let currentSettings: Settings;
let knownModels: CatalogModel[] = [];
let catalogExecutable = "";
let busy = false;
let cancelRequested = false;
let pointerRegion: PointerRegion = "none";
let hitRegions: HitRegions | null = null;
let pointerPollTimer: NodeJS.Timeout | null = null;
const pointerTracker = new PointerRegionTracker();
let shortcutRegistered = false;
let registeredShortcut = "";
let captureProcess: ChildProcess | null = null;
let startupShortcutError = "";
let activeRunId = 0;
let quitting = false;
let lastAnswer: import("./types").QaAnswer | null = null;
let shortcutRecordingSuspended = false;
let runPhase: "capturing" | "thinking" | null = null;
const autoScheduler = new AutoCaptureScheduler(
  { setInterval: (callback, milliseconds) => setInterval(callback, milliseconds), clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout) },
  5_000,
  () => { if (!busy && currentSettings.interactionMode === "auto") void runQaFlow(); }
);

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function writeHotkeyProof(event: string, detail: Record<string, unknown> = {}): void {
  const proofFile = process.env.CHEATYKITTY_HOTKEY_PROOF_FILE;
  if (!app.isPackaged || !proofFile) return;
  void appendFile(proofFile, `${JSON.stringify({ at: new Date().toISOString(), event, pid: process.pid, ...detail })}\n`).catch(() => undefined);
}

function boundedDigest(value: string): { characters: number; sha256: string } {
  return { characters: value.length, sha256: createHash("sha256").update(value).digest("hex") };
}

function diagnosticClass(error: unknown): string {
  const value = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : "RuntimeError";
}

function staticPath(file: string): string {
  return path.join(__dirname, "renderer", file);
}

function nativeHelperPath(file: string): string {
  const proofOverride = app.isPackaged && process.env.CHEATYKITTY_HOTKEY_PROOF_FILE
    ? file === "vision-ocr" ? process.env.CHEATYKITTY_OCR_PROOF_HELPER
      : file === "sck-capture" ? process.env.CHEATYKITTY_SCK_PROOF_HELPER : ""
    : "";
  if (proofOverride) return path.resolve(proofOverride);
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "native", file)
    : path.join(__dirname, "native", file);
}

function sendState(state: OverlayState): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("overlay:state", state);
}

function runtimeState() {
  return { mode: currentSettings.interactionMode, shortcut: shortcutLabel(registeredShortcut || currentSettings.manualShortcut), autoActive: autoScheduler.active, autoIntervalSeconds: currentSettings.autoIntervalSeconds, resultLayout: currentSettings.resultLayout } as const;
}

function retainedAnswer() { return lastAnswer ? { retainedAnswer: lastAnswer } : {}; }

function suspendShortcutForRecording(): { ok: boolean; message: string } {
  if (currentSettings.interactionMode !== "manual") return { ok: false, message: "Switch to Manual mode before recording a shortcut." };
  if (shortcutRecordingSuspended) return { ok: true, message: "Listening for a shortcut." };
  const accelerator = registeredShortcut || currentSettings.manualShortcut;
  const wasRegistered = shortcutRegistered;
  try {
    if (wasRegistered && registeredShortcut) globalShortcut.unregister(registeredShortcut);
    shortcutRegistered = false;
    shortcutRecordingSuspended = true;
    return { ok: true, message: `Listening. ${shortcutLabel(accelerator)} is temporarily paused.` };
  } catch (error) {
    shortcutRecordingSuspended = false;
    try { shortcutRegistered = wasRegistered && globalShortcut.register(accelerator, shortcutAction); }
    catch { shortcutRegistered = false; }
    return { ok: false, message: `Could not safely start recording: ${error instanceof Error ? error.message : String(error)}. ${shortcutRegistered ? `${shortcutLabel(accelerator)} remains active.` : "Use Retry to restore the saved shortcut."}` };
  }
}

function restoreShortcutAfterRecording(): { ok: boolean; message: string } {
  if (!shortcutRecordingSuspended) return shortcutRegistered
    ? { ok: true, message: `${shortcutLabel(registeredShortcut)} is active.` }
    : { ok: false, message: "The saved shortcut is not active. Use Retry." };
  shortcutRecordingSuspended = false;
  const accelerator = registeredShortcut || currentSettings.manualShortcut;
  if (currentSettings.interactionMode !== "manual") return { ok: true, message: "Manual shortcut remains inactive in Auto mode." };
  try {
    shortcutRegistered = globalShortcut.register(accelerator, shortcutAction);
    if (shortcutRegistered) {
      registeredShortcut = accelerator;
      startupShortcutError = "";
      return { ok: true, message: `${shortcutLabel(accelerator)} restored and active.` };
    }
    startupShortcutError = `Could not restore ${shortcutLabel(accelerator)}. Use Retry.`;
  } catch (error) {
    shortcutRegistered = false;
    startupShortcutError = `Could not restore ${shortcutLabel(accelerator)}: ${error instanceof Error ? error.message : String(error)}. Use Retry.`;
  }
  return { ok: false, message: startupShortcutError };
}

function ensureCurrentRun(runId: number): void {
  if (cancelRequested || runId !== activeRunId) throw new Error("Cancelled");
}

function modelLabel(model = currentSettings?.model ?? ""): string {
  return selectedModelLabel(model, currentSettings?.reasoningEffort, currentSettings?.fastMode);
}

function autoDetail(settings = currentSettings): string { return `Auto capture runs every ${settings.autoIntervalSeconds} seconds.`; }

function showOverlayInactive(): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.showInactive();
}

function applyOverlayOpacity(opacity = currentSettings?.overlayOpacity ?? 1): void {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send("overlay:opacity", sanitizeOpacity(opacity));
}

function applyClickThrough(): void {
  if (!overlay || overlay.isDestroyed()) return;
  const ignore = shouldIgnoreMainMouseEvents({
    pointerRegion
  });
  overlay.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
}

function setPointerRegion(region: PointerRegion): void {
  if (pointerRegion === region) return;
  pointerRegion = region;
  applyClickThrough();
}

function resetPointerRegions(): void {
  hitRegions = null;
  const update = pointerTracker.reset();
  if (update.changed || pointerRegion !== "none") setPointerRegion("none");
}

function pollPointerRegion(): void {
  try {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible() || !hitRegions) {
      const update = pointerTracker.reset();
      if (update.changed || pointerRegion !== "none") setPointerRegion("none");
      return;
    }
    const bounds = overlay.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const update = pointerTracker.update(hitRegions, { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
    if (update.changed || pointerRegion !== update.region) setPointerRegion(update.region);
  } catch {
    resetPointerRegions();
  }
}

function validRegion(value: unknown, width: number, height: number): RegionRect | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RegionRect>;
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite)) return null;
  const rect = { x: Number(candidate.x), y: Number(candidate.y), width: Number(candidate.width), height: Number(candidate.height) };
  if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > width || rect.y + rect.height > height) return null;
  return rect;
}

function acceptHitRegions(value: unknown): void {
  if (!overlay || overlay.isDestroyed() || !value || typeof value !== "object") { resetPointerRegions(); return; }
  const [width, height] = overlay.getContentSize();
  const candidate = value as Partial<Record<keyof HitRegions, unknown>>;
  const drag = validRegion(candidate.drag, width, height);
  const settings = validRegion(candidate.settings, width, height);
  const quit = validRegion(candidate.quit, width, height);
  if (!drag || !settings || !quit) { resetPointerRegions(); return; }
  hitRegions = { drag, settings, quit };
  pollPointerRegion();
}

function configurePrivacyWindow(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, "screen-saver");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  window.setContentProtection(true);
}

function createOverlay(): BrowserWindow {
  const primary = screen.getPrimaryDisplay().workArea;
  const width = Math.min(640, Math.max(360, primary.width - 20));
  const height = Math.min(320, Math.max(240, primary.height - 20));
  const window = new BrowserWindow({
    width,
    height,
    x: primary.x + primary.width - width - 20,
    y: primary.y + 20,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  configurePrivacyWindow(window);
  window.loadFile(staticPath("index.html"));
  window.webContents.on("render-process-gone", resetPointerRegions);
  window.on("unresponsive", resetPointerRegions);
  window.once("ready-to-show", () => {
    applyOverlayOpacity();
    applyClickThrough();
    showOverlayInactive();
    if (startupShortcutError) sendState({ kind: "error", message: startupShortcutError, model: modelLabel(), ...runtimeState() });
    else sendState({ kind: "ready", detail: currentSettings.interactionMode === "auto" ? autoDetail() : `Press ${shortcutLabel(currentSettings.manualShortcut)} to capture.`, model: modelLabel(), ...runtimeState() });
    const proofDirectory = process.env.CHEATYKITTY_CAPTURE_PROOF_DIR;
    if (app.isPackaged && proofDirectory) void (async () => {
      try {
        await delay(600);
        const { image, display } = await captureDisplay();
        await writeFile(path.join(proofDirectory, "packaged-filtered.png"), image.toPNG());
        await writeFile(path.join(proofDirectory, "packaged-filtered.geometry.json"), JSON.stringify({ overlay: window.getBounds(), display: { bounds: display.bounds, scaleFactor: display.scaleFactor, id: display.id }, helperPIDExcluded: process.pid }, null, 2));
        window.setContentProtection(false);
        await writeFile(path.join(proofDirectory, "raw-control-ready.txt"), "Content protection disabled only after the production-path filtered capture.\n");
      } catch (error) {
        await writeFile(path.join(proofDirectory, "packaged-filtered.error.txt"), error instanceof Error ? error.stack ?? error.message : String(error));
      }
    })();
  });
  return window;
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  autoScheduler.stop();
  setPointerRegion("none");
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(520, Math.max(420, workArea.width - 20));
  const height = Math.min(860, Math.max(560, workArea.height - 20));
  const window = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    frame: false,
    transparent: false,
    backgroundColor: "#101010",
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWindow = window;
  configurePrivacyWindow(window);
  window.setOpacity(1);
  window.loadFile(staticPath("settings.html"));
  window.webContents.on("render-process-gone", restoreShortcutAfterRecording);
  window.on("unresponsive", restoreShortcutAfterRecording);
  window.once("ready-to-show", () => { window.show(); window.focus(); });
  window.on("closed", () => {
    restoreShortcutAfterRecording();
    settingsWindow = null;
    setPointerRegion("none");
    applyOverlayOpacity();
    applyClickThrough();
    if (currentSettings.interactionMode === "auto" && !quitting) autoScheduler.start();
  });
}

async function captureDisplay(): Promise<{ image: Electron.NativeImage; display: Electron.Display }> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const executable = nativeHelperPath("sck-capture");
  const png = await runCaptureHelper(executable, [String(display.id), String(process.pid)], {
    timeoutMs: app.isPackaged && process.env.CHEATYKITTY_HOTKEY_PROOF_FILE && process.env.CHEATYKITTY_SCK_PROOF_TIMEOUT_MS
      ? Math.max(50, Math.min(20_000, Number(process.env.CHEATYKITTY_SCK_PROOF_TIMEOUT_MS) || 20_000)) : undefined,
    isCancelled: () => cancelRequested,
    onProcess: (child) => { captureProcess = child; }
  });
  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) throw new Error("ScreenCaptureKit returned no image. Allow Screen Recording for CheatyKitty in System Settings → Privacy & Security, then restart CheatyKitty.");
  return { image, display };
}

function selectArea(image: Electron.NativeImage, display: Electron.Display): Promise<Electron.NativeImage> {
  return new Promise((resolve, reject) => {
    const bounds = display.bounds;
    const window = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    selectionWindow = window;
    configurePrivacyWindow(window);
    let settled = false;
    const finish = (rect?: { x: number; y: number; width: number; height: number }) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler("selection:complete");
      ipcMain.removeHandler("selection:cancel");
      if (rect && rect.width >= 10 && rect.height >= 10) {
        const size = image.getSize();
        const scaleX = size.width / bounds.width;
        const scaleY = size.height / bounds.height;
        resolve(image.crop({
          x: Math.max(0, Math.round(rect.x * scaleX)),
          y: Math.max(0, Math.round(rect.y * scaleY)),
          width: Math.min(size.width, Math.round(rect.width * scaleX)),
          height: Math.min(size.height, Math.round(rect.height * scaleY))
        }));
      } else {
        reject(new Error("Area selection cancelled"));
      }
      if (!window.isDestroyed()) window.close();
      selectionWindow = null;
    };
    ipcMain.handle("selection:complete", (_event, rect) => finish(rect));
    ipcMain.handle("selection:cancel", () => finish());
    window.on("closed", () => finish());
    window.webContents.once("did-finish-load", () => {
      window.webContents.send("selection:image", { dataUrl: image.toDataURL() });
      window.show();
    });
    window.loadFile(staticPath("selection.html"));
  });
}

async function runQaFlow(): Promise<void> {
  if (busy) return;
  const runId = ++activeRunId;
  busy = true;
  cancelRequested = false;
  try {
    const executable = await preflightCodex(currentSettings.codexPath);
    if (catalogExecutable !== executable.path) {
      try { knownModels = await listCodexModels(executable); catalogExecutable = executable.path; }
      catch { knownModels = []; catalogExecutable = executable.path; } // Refresh in Settings retries discovery.
    }
    ensureCurrentRun(runId);
    runPhase = "capturing";
    writeHotkeyProof("run-phase", { runId, phase: runPhase });
    sendState({ kind: "capturing", model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
    await delay(UI_FEEDBACK_MS);
    ensureCurrentRun(runId);
    let { image, display } = await captureDisplay();
    ensureCurrentRun(runId);
    if (currentSettings.captureMode === "area") {
      image = await selectArea(image, display);
    }
    ensureCurrentRun(runId);
    runPhase = "thinking";
    writeHotkeyProof("run-phase", { runId, phase: runPhase });
    sendState({ kind: "thinking", model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
    const answer = await runCodex(image.toPNG(), executable, currentSettings.timeoutSeconds, currentSettings.model, currentSettings.reasoningEffort, {
      fastMode: currentSettings.fastMode,
      imageAttached: knownModels.find((entry) => entry.model === currentSettings.model)?.inputModalities.includes("image"),
      ocrExecutable: nativeHelperPath("vision-ocr"),
      onInvocation: (proof) => writeHotkeyProof("codex-invocation", {
        runId,
        attempt: proof.attempt,
        model: proof.model,
        reasoningEffort: proof.reasoningEffort,
        fastMode: proof.fastMode,
        input: proof.imageAttached ? "image+local-ocr" : "local-ocr-text-only",
        imageAttached: proof.imageAttached,
        ocrAvailable: proof.ocrAvailable,
        ocrCharacters: proof.ocrText.length,
        ocrSha256: createHash("sha256").update(proof.ocrText).digest("hex"),
        recognizedLabelCount: proof.labeledOptionLabels.length,
        recognizedLabelsSha256: createHash("sha256").update(proof.labeledOptionLabels.join("\n")).digest("hex"),
        orderedChoiceCount: proof.orderedOptionSha256s.length,
        orderedChoiceSha256s: proof.orderedOptionSha256s,
        hasImageFlag: proof.args.includes("--image")
      })
    });
    ensureCurrentRun(runId);
    if (!isCompleteResult(answer)) throw new Error("Codex returned an incomplete question or answer; the previous result was kept.");
    lastAnswer = commitCurrentResult(lastAnswer, answer, runId, activeRunId, cancelRequested);
    if (lastAnswer !== answer) throw new Error("A stale capture completed after a newer run; the previous result was kept.");
    sendState({ kind: "answer", answer, model: modelLabel(), ...runtimeState() });
    const resultDigest = boundedDigest(answer.text);
    const queryDigest = boundedDigest(answer.questionText);
    writeHotkeyProof("run-complete", { runId, outcome: "answer", label: answer.label, resultCharacters: resultDigest.characters, resultSha256: resultDigest.sha256, queryCharacters: queryDigest.characters, querySha256: queryDigest.sha256, confidence: answer.confidence });
  } catch (error) {
    if (cancelRequested || runId !== activeRunId) sendState({ kind: "cancelled", model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
    else {
      if (currentSettings.interactionMode === "auto") autoScheduler.stop();
      const message = error instanceof Error ? error.message : String(error);
      sendState({ kind: "error", message, model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
      const diagnostic = boundedDigest(message);
      writeHotkeyProof("run-error", { runId, phase: runPhase, errorClass: diagnosticClass(error), diagnosticCharacters: diagnostic.characters, diagnosticSha256: diagnostic.sha256 });
    }
    writeHotkeyProof("run-complete", { runId, outcome: cancelRequested || runId !== activeRunId ? "cancelled" : "error" });
  } finally {
    busy = false;
    runPhase = null;
    cancelRequested = false;
  }
}

function cancelQaFlow(): void {
  if (!busy) return;
  activeRunId += 1;
  cancelRequested = true;
  if (captureProcess) terminateCaptureHelper(captureProcess);
  cancelCodex();
  if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();
  sendState({ kind: "cancelled", model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
}

function shortcutAction(): void {
  writeHotkeyProof("shortcut-fired", { accelerator: registeredShortcut || currentSettings.manualShortcut, busy });
  if (busy) cancelQaFlow(); else void runQaFlow();
}

function configureInteractionMode(): void {
  autoScheduler.stop();
  autoScheduler.setIntervalMs(currentSettings.autoIntervalSeconds * 1000);
  if (currentSettings.interactionMode === "auto" && !settingsWindow) autoScheduler.start();
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => currentSettings);
  ipcMain.handle("settings:save", async (_event, settings: Settings) => {
    if (shortcutRecordingSuspended) {
      const restored = restoreShortcutAfterRecording();
      if (currentSettings.interactionMode === "manual" && !restored.ok) throw new Error(restored.message);
    }
    if (settings.interactionMode === "auto" && settings.captureMode === "area") throw new Error("Auto capture requires Current display. Area selection needs Manual mode.");
    const validation = validateHotkey(settings.manualShortcut);
    if (!validation.ok) throw new Error(validation.message);
    const nextSettings = { ...settings, manualShortcut: validation.accelerator };
    const transaction = await transactShortcutRegistration(globalShortcut, {
      mode: currentSettings.interactionMode,
      accelerator: registeredShortcut || currentSettings.manualShortcut,
      registered: shortcutRegistered
    }, { mode: nextSettings.interactionMode, accelerator: nextSettings.manualShortcut }, shortcutAction, () => saveSettings(app.getPath("userData"), nextSettings));
    if (!transaction.ok) {
      if (!transaction.rollback.ok) {
        shortcutRegistered = false;
        registeredShortcut = currentSettings.manualShortcut;
        startupShortcutError = transaction.rollback.message;
        sendState({ kind: "error", message: transaction.rollback.message, model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
        throw new Error(`${transaction.error instanceof Error ? transaction.error.message : String(transaction.error)} ${transaction.rollback.message}`);
      }
      throw transaction.error;
    }
    const saved: Settings = transaction.saved;
    const modeChanged = saved.interactionMode !== currentSettings.interactionMode;
    shortcutRegistered = saved.interactionMode === "manual";
    registeredShortcut = shortcutRegistered ? saved.manualShortcut : "";
    currentSettings = saved;
    if (modeChanged && busy) cancelQaFlow();
    configureInteractionMode();
    applyOverlayOpacity();
    if (!busy) sendState({ kind: "ready", detail: saved.interactionMode === "auto" ? autoDetail(saved) : `Press ${shortcutLabel(saved.manualShortcut)} to capture.`, model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
    else sendState({ kind: runPhase || "thinking", model: modelLabel(), ...retainedAnswer(), ...runtimeState() });
    return currentSettings;
  });
  ipcMain.handle("shortcut:validate", (_event, shortcut: string) => validateHotkey(shortcut));
  ipcMain.handle("shortcut:recording-start", () => suspendShortcutForRecording());
  ipcMain.handle("shortcut:recording-check", (_event, shortcut: string) => {
    let result: ReturnType<typeof validateHotkey> = { ok: false, message: "Shortcut validation failed." };
    try {
      if (!shortcutRecordingSuspended) result = { ok: false, message: "Recording session ended. Start recording again." };
      else {
        result = validateHotkey(shortcut);
        if (result.ok) {
          const available = globalShortcut.register(result.accelerator, () => undefined);
          if (available) globalShortcut.unregister(result.accelerator);
          else result = { ok: false, message: `${shortcutLabel(result.accelerator)} is already used by another app.` };
        }
      }
    } catch (error) {
      result = { ok: false, message: `Could not validate shortcut: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      const restored = restoreShortcutAfterRecording();
      if (!restored.ok) result = { ok: false, message: restored.message };
    }
    return result;
  });
  ipcMain.handle("shortcut:recording-stop", () => restoreShortcutAfterRecording());
  ipcMain.handle("shortcut:retry", () => {
    if (currentSettings.interactionMode !== "manual") return { ok: false, message: "Switch to Manual mode before registering a shortcut." };
    if (shortcutRegistered && registeredShortcut === currentSettings.manualShortcut) return { ok: true, message: `${shortcutLabel(registeredShortcut)} is already active.` };
    const staged = stageShortcutRegistration(globalShortcut, { mode: "manual", accelerator: registeredShortcut || currentSettings.manualShortcut, registered: shortcutRegistered }, { mode: "manual", accelerator: currentSettings.manualShortcut }, shortcutAction);
    staged.activate();
    shortcutRegistered = true;
    registeredShortcut = currentSettings.manualShortcut;
    startupShortcutError = "";
    return { ok: true, message: `${shortcutLabel(registeredShortcut)} is active.` };
  });
  ipcMain.handle("settings:preview-opacity", (_event, opacity: number) => applyOverlayOpacity(opacity));
  ipcMain.on("settings:open", openSettingsWindow);
  ipcMain.on("settings:close", () => { restoreShortcutAfterRecording(); settingsWindow?.close(); });
  ipcMain.on("app:quit", () => app.quit());
  ipcMain.handle("codex:choose", async () => {
    const result = await dialog.showOpenDialog(settingsWindow ?? overlay!, { title: "Choose local Codex executable", properties: ["openFile"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("codex:inspect", (_event, customPath: string) => inspectCodex(customPath));
  ipcMain.handle("codex:models", async (_event, customPath: string) => {
    const executable = await preflightCodex(customPath);
    const models = await listCodexModels(executable);
    knownModels = models; catalogExecutable = executable.path;
    return models;
  });
  ipcMain.handle("codex:test", async (_event, customPath: string, model: Settings["model"], reasoningEffort: Settings["reasoningEffort"], fastMode: boolean) => {
    const diagnostic = await inspectCodex(customPath);
    if (diagnostic.status !== "ready") return {
      connectionStatus: diagnostic.status === "wrong-binary" ? "wrong-binary" : "error",
      modelStatus: "Not tested",
      message: diagnostic.message
    };
    return testCodex(diagnostic.resolvedPath, model, reasoningEffort, fastMode === true);
  });
  ipcMain.on("codex:cancel", cancelQaFlow);
  ipcMain.on("overlay:hit-regions", (_event, regions: unknown) => acceptHitRegions(regions));
  ipcMain.on("overlay:clear-hit-regions", resetPointerRegions);
  ipcMain.handle("overlay:content-height", (_event, requestedHeight: number) => {
    if (!overlay || overlay.isDestroyed() || !Number.isFinite(requestedHeight)) return;
    const workArea = screen.getDisplayMatching(overlay.getBounds()).workArea;
    const height = Math.max(240, Math.min(Math.ceil(requestedHeight), workArea.height - 20));
    const bounds = overlay.getBounds();
    const y = Math.max(workArea.y + 10, Math.min(bounds.y, workArea.y + workArea.height - height - 10));
    overlay.setBounds({ x: bounds.x, y, width: bounds.width, height }, false);
  });
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.hide();
  Menu.setApplicationMenu(null);
  const userData = app.getPath("userData");
  // Compatibility-only former product directory; it is read once and never deleted.
  const legacyUserData = path.join(app.getPath("appData"), "PeekaTest");
  const loaded = await loadSettingsWithFallback(userData, legacyUserData);
  currentSettings = loaded.settings;
  if (loaded.migrated) await saveSettings(userData, currentSettings).catch(() => undefined);
  const validation = validateHotkey(currentSettings.manualShortcut);
  if (!validation.ok) currentSettings.manualShortcut = "CommandOrControl+Shift+Space";
  else currentSettings.manualShortcut = validation.accelerator;
  registerIpc();
  overlay = createOverlay();
  pointerPollTimer = setInterval(pollPointerRegion, 40);
  pointerPollTimer.unref();
  if (currentSettings.interactionMode === "manual") {
    shortcutRegistered = globalShortcut.register(currentSettings.manualShortcut, shortcutAction);
    if (shortcutRegistered) registeredShortcut = currentSettings.manualShortcut;
    else if (currentSettings.manualShortcut !== DEFAULT_SETTINGS.manualShortcut && globalShortcut.register(DEFAULT_SETTINGS.manualShortcut, shortcutAction)) {
      shortcutRegistered = true;
      registeredShortcut = DEFAULT_SETTINGS.manualShortcut;
      startupShortcutError = `Saved shortcut ${shortcutLabel(currentSettings.manualShortcut)} is unavailable. Fallback ${shortcutLabel(registeredShortcut)} is active; open Settings to Retry or save another shortcut.`;
    } else startupShortcutError = `Could not register ${shortcutLabel(currentSettings.manualShortcut)}. Open Settings to Retry or choose another shortcut.`;
  }
  writeHotkeyProof("startup-registration", { configured: currentSettings.manualShortcut, registered: registeredShortcut, active: shortcutRegistered, error: startupShortcutError });
  if (app.isPackaged && process.env.CHEATYKITTY_HOTKEY_PROOF_TRIGGER === "1" && shortcutRegistered) {
    setTimeout(() => shortcutAction(), 800).unref();
  }
  configureInteractionMode();
  if (process.env.CHEATYKITTY_SMOKE === "1") setTimeout(() => app.quit(), 1200).unref();
});

app.on("will-quit", () => {
  quitting = true;
  autoScheduler.stop();
  if (pointerPollTimer) clearInterval(pointerPollTimer);
  pointerPollTimer = null;
  resetPointerRegions();
  cancelRequested = true;
  if (captureProcess) terminateCaptureHelper(captureProcess);
  cancelCodex();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => { /* background shortcut remains active */ });
