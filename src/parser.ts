import type { QaAnswer } from "./types";

function normalizeConfidence(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace("%", ""));
    if (!Number.isFinite(parsed)) return null;
    value = value.includes("%") ? parsed / 100 : parsed;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

export function parseCodexAnswer(rawInput: string): QaAnswer {
  const raw = rawInput.trim();
  const candidates = [raw, raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? ""];
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate) as Record<string, unknown>;
      const questionText = String(data.question_text ?? data.questionText ?? "").trim();
      const label = String(data.option_label ?? "").trim() || String(data.option_number ?? data.answer_label ?? data.label ?? "").trim();
      const text = String(data.answer_text ?? data.text ?? "").trim();
      if (label || text) {
        return { questionText, label, text, confidence: normalizeConfidence(data.confidence), raw };
      }
    } catch {
      // Continue to the deliberately permissive text fallback.
    }
  }

  const firstLine = raw.split(/\r?\n/).find(Boolean) ?? "No answer returned";
  const answerMatch = firstLine.match(/^\s*([A-ZА-Я]|\d+)\s*[).:—-]?\s*(.*)$/u);
  return {
    questionText: "",
    label: answerMatch?.[1] ?? "",
    text: answerMatch?.[2]?.trim() || firstLine.trim(),
    confidence: null,
    raw
  };
}
