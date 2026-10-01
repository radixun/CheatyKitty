import type { QaAnswer } from "./types";

export function isCompleteResult(answer: QaAnswer): boolean {
  return Boolean(answer.questionText.trim() && (answer.label.trim() || answer.text.trim()));
}

export function commitCurrentResult(previous: QaAnswer | null, candidate: QaAnswer, runId: number, activeRunId: number, cancelled: boolean): QaAnswer {
  if (cancelled || runId !== activeRunId || !isCompleteResult(candidate)) return previous as QaAnswer;
  return candidate;
}
