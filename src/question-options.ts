import type { QaAnswer } from "./types";

export interface OcrLine { text: string; confidence: number; x?: number; y?: number; width?: number; height?: number }
export interface AnswerOption { label: string; text: string }
export interface QuestionContext { lines: OcrLine[]; questionText: string; options: AnswerOption[]; orderedOptions?: AnswerOption[]; ocrText: string; ocrAvailable?: boolean; ocrDiagnostic?: string }

const OPTION_PATTERN = /^\s*([A-ZА-Я]|\d{1,3})\s*[.)\]:—-]\s*(.+?)\s*$/iu;
const INLINE_OPTION_PATTERN = /(?:^|\s)([A-ZА-Я]|\d{1,3})\s*[.)\]:—-]\s*(.*?)(?=\s+(?:[A-ZА-Я]|\d{1,3})\s*[.)\]:—-]\s|$)/giu;
const LETTER_ORDER = "ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";

interface PositionedOption extends AnswerOption { lineIndex: number; line: OcrLine }

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, " ").trim();
}

function collapseDuplicate(value: string): string {
  const text = value.trim();
  const match = text.match(/^(.+?)\s+[—–-]\s+(.+)$/u);
  return match && normalize(match[1]) === normalize(match[2]) ? match[1].trim() : text;
}

function labelPosition(label: string): { kind: "number" | "letter"; value: number } | null {
  if (/^\d{1,3}$/u.test(label)) return { kind: "number", value: Number(label) };
  const index = LETTER_ORDER.indexOf(label.toUpperCase());
  return index >= 0 ? { kind: "letter", value: index } : null;
}

function hasCoherentGeometry(group: PositionedOption[]): boolean {
  const hasGeometry = group.every(({ line }) => [line.x, line.y, line.height].every((value) => typeof value === "number" && Number.isFinite(value)));
  if (!hasGeometry) return true;
  const firstHeight = group[0].line.height ?? 1;
  return group.every(({ line }, index) => {
    const heightRatio = (line.height ?? 0) / firstHeight;
    if (Math.abs((line.x ?? 0) - (group[0].line.x ?? 0)) > .035 || heightRatio < .55 || heightRatio > 1.8) return false;
    if (index === 0) return true;
    const gap = (group[index - 1].line.y ?? 0) - (line.y ?? 0);
    return gap > .004 && gap <= .2;
  });
}

function bestSequentialCluster(candidates: PositionedOption[]): PositionedOption[] {
  const groups: PositionedOption[][] = [];
  for (let start = 0; start < candidates.length; start += 1) {
    const initialPosition = labelPosition(candidates[start].label);
    if (!initialPosition || (initialPosition.kind === "number" && initialPosition.value < 1)) continue;
    const group = [candidates[start]];
    let previousPosition = initialPosition;
    for (let index = start + 1; index < candidates.length; index += 1) {
      const position = labelPosition(candidates[index].label);
      if (!position || position.kind !== previousPosition.kind || position.value !== previousPosition.value + 1) continue;
      const proposed = [...group, candidates[index]];
      if (!hasCoherentGeometry(proposed)) continue;
      group.push(candidates[index]);
      previousPosition = position;
    }
    if (group.length >= 2) groups.push(group);
  }
  return groups.sort((left, right) => right.length - left.length ||
    right.reduce((sum, option) => sum + option.text.length, 0) - left.reduce((sum, option) => sum + option.text.length, 0))[0] ?? [];
}

function inferOrderedUnlabeledOptions(lines: OcrLine[]): AnswerOption[] {
  const positioned = lines.filter((line) =>
    line.confidence >= .45 && line.text.length >= 2 &&
    [line.x, line.y, line.width, line.height].every((value) => typeof value === "number" && Number.isFinite(value)) &&
    (line.height ?? 0) >= .012
  );
  const candidates: OcrLine[][] = [];
  for (let start = 0; start < positioned.length; start += 1) {
    const group = [positioned[start]];
    for (let index = start + 1; index < positioned.length; index += 1) {
      const first = group[0];
      const previous = group.at(-1)!;
      const current = positioned[index];
      const heightRatio = (current.height ?? 0) / (first.height ?? 1);
      const verticalGap = (previous.y ?? 0) - (current.y ?? 0);
      const minimumCardGap = Math.max(.018, (first.height ?? 0) * 1.45);
      const maximumCardGap = Math.max(.09, (first.height ?? 0) * 4.5);
      if (Math.abs((current.x ?? 0) - (first.x ?? 0)) <= .008 && heightRatio >= .8 && heightRatio <= 1.25 && verticalGap >= minimumCardGap && verticalGap <= maximumCardGap) {
        group.push(current);
      }
    }
    if (group.length >= 3 && group.length <= 8) candidates.push(group);
  }
  const best = candidates.sort((left, right) => {
    const score = (group: OcrLine[]) => group.reduce((total, line) => total + Math.min(line.text.length, 120), 0) * Math.min(group.length, 5);
    return score(right) - score(left);
  })[0];
  if (!best) return [];
  return best.map((line, index) => ({ label: String(index + 1), text: line.text }));
}

export function parseOcrPayload(raw: string): QuestionContext {
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { throw new Error("Local Vision OCR returned invalid JSON."); }
  const entries = (payload as { lines?: unknown })?.lines;
  if (!Array.isArray(entries)) throw new Error("Local Vision OCR returned no line list.");
  const lines = entries.map((entry) => {
    const record = entry as Record<string, unknown>;
    const number = (key: string): number | undefined => typeof record[key] === "number" && Number.isFinite(record[key]) ? Number(record[key]) : undefined;
    return { text: String(record.text ?? "").replace(/\s+/g, " ").trim(), confidence: Number(record.confidence ?? 0), x: number("x"), y: number("y"), width: number("width"), height: number("height") };
  }).filter((line) => line.text);
  const ocrText = lines.map((line) => line.text).join("\n");
  if (lines.length < 1 || ocrText.replace(/\s/g, "").length < 8) throw new Error("Local Vision OCR could not extract enough question text. Try a larger capture area or clearer text.");
  const lineCandidates: PositionedOption[] = [];
  lines.forEach((line, index) => {
    const match = line.text.match(OPTION_PATTERN);
    if (!match) return;
    lineCandidates.push({ label: match[1].toUpperCase(), text: match[2].trim(), lineIndex: index, line });
  });
  const lineCluster = bestSequentialCluster(lineCandidates);
  const options: AnswerOption[] = lineCluster.map(({ label, text }) => ({ label, text }));
  const firstOptionIndex = lineCluster[0]?.lineIndex ?? -1;
  let questionText = (firstOptionIndex >= 0 ? lines.slice(0, firstOptionIndex) : lines).map((line) => line.text).join(" ").trim();
  if (options.length === 0) {
    const inlineGroups = lines.map((line, lineIndex) => {
      const matches = [...line.text.matchAll(INLINE_OPTION_PATTERN)];
      const candidates = matches.map((match) => ({ label: match[1].toUpperCase(), text: match[2].trim(), lineIndex, line: { text: line.text, confidence: line.confidence } }));
      return { lineIndex, line, matches, cluster: bestSequentialCluster(candidates) };
    }).filter(({ cluster }) => cluster.length >= 2)
      .sort((left, right) => right.cluster.length - left.cluster.length || right.cluster.reduce((sum, option) => sum + option.text.length, 0) - left.cluster.reduce((sum, option) => sum + option.text.length, 0));
    const inline = inlineGroups[0];
    if (inline) {
      options.push(...inline.cluster.map(({ label, text }) => ({ label, text })));
      const prefix = inline.line.text.slice(0, inline.matches[0]?.index ?? 0).trim();
      questionText = [...lines.slice(0, inline.lineIndex).map((line) => line.text), prefix].filter(Boolean).join(" ").trim();
    }
  }
  const orderedOptions = options.length === 0 ? inferOrderedUnlabeledOptions(lines) : [];
  return { lines, questionText, options, orderedOptions, ocrText, ocrAvailable: true };
}

export class AnswerResolutionError extends Error {}

export type AnswerAuthority = "vision-image" | "ocr-text";
export interface ReconcileOptions { finalAttempt?: boolean; authority?: AnswerAuthority }

export function reconcileAnswer(answer: QaAnswer, context: QuestionContext, options: ReconcileOptions = {}): QaAnswer {
  const questionText = answer.questionText.trim() || context.questionText;
  const suppliedLabel = answer.label.trim().replace(/[.):—-]+$/u, "").toUpperCase();
  const safeLabel = /^(?:[A-ZА-Я]|\d{1,3})$/u.test(suppliedLabel) ? suppliedLabel : "";
  let suppliedText = collapseDuplicate(answer.text);
  if (suppliedLabel) {
    const prefixed = suppliedText.match(new RegExp(`^${suppliedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.):—-]\\s*(.+)$`, "iu"));
    if (prefixed) suppliedText = prefixed[1].trim();
  }
  if (context.ocrAvailable === false) {
    if (!suppliedText) throw new AnswerResolutionError("The image answer was empty while local OCR was unavailable.");
    return { ...answer, questionText, label: safeLabel, text: suppliedText };
  }
  if (options.authority === "vision-image" && /^\d{1,3}$/u.test(safeLabel)) {
    if (!suppliedText) throw new AnswerResolutionError("The image answer text was empty.");
    return { ...answer, questionText, label: safeLabel, text: suppliedText };
  }
  if (context.options.length === 0) {
    if (!suppliedText) throw new AnswerResolutionError("The open-ended answer was empty.");
    const orderedOptions = context.orderedOptions ?? [];
    if (orderedOptions.length >= 3) {
      const orderedMatches = orderedOptions.filter((option) => normalize(option.text) === normalize(suppliedText));
      if (orderedMatches.length === 1 && (!/^\d{1,3}$/u.test(safeLabel) || orderedOptions.length >= 4)) return { ...answer, questionText, label: orderedMatches[0].label, text: orderedMatches[0].text };
      if (/^[A-ZА-Я]$/u.test(safeLabel)) return { ...answer, questionText, label: "", text: suppliedText };
    }
    return { ...answer, questionText, label: safeLabel, text: suppliedText };
  }

  const byLabel = context.options.find((option) => option.label === suppliedLabel);
  const answerNeedle = normalize(suppliedText || suppliedLabel);
  const textMatches = answerNeedle ? context.options.filter((option) => normalize(option.text) === answerNeedle) : [];
  if (!suppliedText) throw new AnswerResolutionError("The returned answer text was empty.");
  if (byLabel) {
    if (textMatches.length === 1 && textMatches[0].label !== byLabel.label && !options.finalAttempt && options.authority !== "vision-image") throw new AnswerResolutionError("The returned option label conflicts with the returned answer text.");
    if (textMatches.length === 1 && textMatches[0].label === byLabel.label) return { ...answer, questionText, label: byLabel.label, text: byLabel.text };
    return { ...answer, questionText, label: byLabel.label, text: suppliedText };
  }
  if (textMatches.length === 1) return { ...answer, questionText, label: textMatches[0].label, text: textMatches[0].text };
  if (safeLabel) return { ...answer, questionText, label: safeLabel, text: suppliedText };
  if (options.finalAttempt) return { ...answer, questionText, label: "", text: suppliedText };
  if (textMatches.length > 1) throw new AnswerResolutionError("The returned answer text matches multiple visible options.");
  throw new AnswerResolutionError("The returned answer could not be matched to one visible option.");
}

export function formatAnswer(answer: Pick<QaAnswer, "label" | "text">): string {
  const label = answer.label.trim();
  const text = collapseDuplicate(answer.text);
  if (!label) return text || "No answer returned.";
  if (normalize(label) === normalize(text)) return text || "No answer returned.";
  return `${label} — ${text || "No answer returned."}`;
}
