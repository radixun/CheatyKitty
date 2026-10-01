export type CaptureMode = "display" | "area";
export type InteractionMode = "manual" | "auto";
export type ResultLayout = "question-answer" | "answer-only";
import type { ModelId, ReasoningEffort } from "./model-options";

export interface Settings {
  codexPath: string;
  timeoutSeconds: number;
  captureMode: CaptureMode;
  model: ModelId;
  reasoningEffort: ReasoningEffort;
  autoIntervalSeconds: number;
  overlayOpacity: number;
  interactionMode: InteractionMode;
  manualShortcut: string;
  resultLayout: ResultLayout;
}

export interface QaAnswer {
  questionText: string;
  label: string;
  text: string;
  confidence: number | null;
  raw: string;
}

export interface CodexDiagnostic {
  resolvedPath: string;
  source: string;
  status: "ready" | "not-found" | "not-executable" | "wrong-binary" | "error";
  version: string;
  authStatus: "authenticated" | "not-authenticated" | "unknown";
  modelStatus: string;
  connectionStatus: string;
  message: string;
}

export interface CodexTestResult {
  connectionStatus: "connected" | "wrong-binary" | "not-authenticated" | "model-unavailable" | "network-error" | "timeout" | "error";
  modelStatus: string;
  message: string;
}

export type OverlayState =
  | { kind: "ready"; detail?: string; retainedAnswer?: QaAnswer; model: string; mode: InteractionMode; shortcut: string; autoActive: boolean; autoIntervalSeconds: number; resultLayout: ResultLayout }
  | { kind: "capturing"; retainedAnswer?: QaAnswer; model: string; mode: InteractionMode; shortcut: string; autoActive: boolean; autoIntervalSeconds: number; resultLayout: ResultLayout }
  | { kind: "thinking"; retainedAnswer?: QaAnswer; model: string; mode: InteractionMode; shortcut: string; autoActive: boolean; autoIntervalSeconds: number; resultLayout: ResultLayout }
  | { kind: "answer"; answer: QaAnswer; model: string; mode: InteractionMode; shortcut: string; autoActive: boolean; autoIntervalSeconds: number; resultLayout: ResultLayout }
  | { kind: "cancelled"; retainedAnswer?: QaAnswer; model: string; mode: InteractionMode; shortcut: string; autoActive: boolean; autoIntervalSeconds: number; resultLayout: ResultLayout }
  | { kind: "error"; message: string; retainedAnswer?: QaAnswer; model: string; mode: InteractionMode; shortcut: string; autoActive: boolean; autoIntervalSeconds: number; resultLayout: ResultLayout };
