export const DEFAULT_MODEL = "gpt-5.6-luna";
export const DEFAULT_REASONING_EFFORT = "medium";

// Catalog suggestions are advisory. New IDs and effort levels must remain usable.
export type ModelId = string;
export type ReasoningEffort = string;

export function normalizeModel(value: unknown): ModelId {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model || /^default [—-] 5\.6 luna · medium$/i.test(model)) return DEFAULT_MODEL;
  if (/^5\.3 codex spark$/i.test(model)) return "gpt-5.3-codex-spark";
  return model;
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : DEFAULT_REASONING_EFFORT;
}

export function modelLabel(model: unknown, effort: unknown = DEFAULT_REASONING_EFFORT, fast = false): string {
  return `${normalizeModel(model)} · ${normalizeReasoningEffort(effort)}${fast ? " · FAST" : ""}`;
}
