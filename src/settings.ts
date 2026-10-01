import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Settings } from "./types";
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, normalizeModel, normalizeReasoningEffort } from "./model-options";

export const DEFAULT_SETTINGS: Settings = {
  codexPath: "",
  timeoutSeconds: 90,
  captureMode: "display",
  model: DEFAULT_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  fastMode: false,
  autoIntervalSeconds: 5,
  overlayOpacity: 1,
  interactionMode: "manual",
  manualShortcut: "CommandOrControl+Shift+Space",
  resultLayout: "question-answer"
};

export function sanitizeOpacity(value: unknown): number {
  const opacity = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(opacity)) return DEFAULT_SETTINGS.overlayOpacity;
  return Math.round(Math.max(0.25, Math.min(1, opacity)) * 100) / 100;
}

export function sanitizeAutoInterval(value: unknown): number {
  const seconds = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_SETTINGS.autoIntervalSeconds;
  return Math.max(3, Math.min(15, Math.round(seconds)));
}

type SettingsInput = Partial<Settings> & { codexExecutable?: unknown; codexCliPath?: unknown };

export function sanitizeSettings(settings: SettingsInput): Settings {
  const legacyPath = typeof settings.codexExecutable === "string" ? settings.codexExecutable :
    typeof settings.codexCliPath === "string" ? settings.codexCliPath : "";
  const interactionMode = settings.interactionMode === "auto" ? "auto" : "manual";
  return {
    codexPath: typeof settings.codexPath === "string" ? settings.codexPath.trim() : legacyPath.trim(),
    timeoutSeconds: Number.isFinite(settings.timeoutSeconds) ? Math.max(15, Math.min(300, Number(settings.timeoutSeconds))) : 90,
    captureMode: interactionMode === "auto" ? "display" : settings.captureMode === "area" ? "area" : "display",
    model: normalizeModel(settings.model),
    reasoningEffort: normalizeReasoningEffort(settings.reasoningEffort),
    fastMode: settings.fastMode === true,
    autoIntervalSeconds: sanitizeAutoInterval(settings.autoIntervalSeconds),
    overlayOpacity: sanitizeOpacity(settings.overlayOpacity),
    interactionMode,
    manualShortcut: typeof settings.manualShortcut === "string" && settings.manualShortcut.trim()
      ? settings.manualShortcut.trim().slice(0, 128)
      : DEFAULT_SETTINGS.manualShortcut,
    resultLayout: settings.resultLayout === "answer-only" ? "answer-only" : "question-answer"
  };
}

export async function loadSettingsWithFallback(primaryUserData: string, legacyUserData: string): Promise<{ settings: Settings; migrated: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(path.join(primaryUserData, "settings.json"), "utf8")) as Partial<Settings>;
    return { settings: sanitizeSettings(parsed), migrated: false };
  } catch (error) {
    if (!isMissingFile(error)) return { settings: { ...DEFAULT_SETTINGS }, migrated: false };
    try {
      const parsed = JSON.parse(await readFile(path.join(legacyUserData, "settings.json"), "utf8")) as Partial<Settings>;
      return { settings: { ...sanitizeSettings(parsed), codexPath: "" }, migrated: true };
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, migrated: false };
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

export async function saveSettings(userData: string, settings: Settings): Promise<Settings> {
  const sanitized = sanitizeSettings(settings);
  await mkdir(userData, { recursive: true, mode: 0o700 });
  const target = path.join(userData, "settings.json");
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(sanitized, null, 2), { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return sanitized;
}
