export const DEFAULT_MODEL = "gpt-5.6-luna" as const;
export const DEFAULT_REASONING_EFFORT = "medium" as const;

export const MODEL_OPTIONS = [
  { id: DEFAULT_MODEL, effort: DEFAULT_REASONING_EFFORT, label: "Default — 5.6 Luna · Medium" },
  { id: "gpt-5.6-sol", effort: DEFAULT_REASONING_EFFORT, label: "5.6 Sol · Medium" },
  { id: "gpt-5.3-codex-spark", effort: DEFAULT_REASONING_EFFORT, label: "5.3 Codex Spark · Medium" }
] as const;

export type ModelId = typeof MODEL_OPTIONS[number]["id"];
export type ReasoningEffort = typeof DEFAULT_REASONING_EFFORT;

export function normalizeModel(value: unknown): ModelId {
  const model = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (model === "gpt-5.6-sol") return "gpt-5.6-sol";
  if (model === "gpt-5.3-codex-spark" || model === "5.3 codex spark") return "gpt-5.3-codex-spark";
  if (model === "gpt-5.6-luna" || model === "default — 5.6 luna · medium" || model === "default - 5.6 luna · medium") return DEFAULT_MODEL;
  return DEFAULT_MODEL;
}

export function modelLabel(model: unknown): string {
  const normalized = normalizeModel(model);
  return MODEL_OPTIONS.find((option) => option.id === normalized)?.label ?? MODEL_OPTIONS[0].label;
}
