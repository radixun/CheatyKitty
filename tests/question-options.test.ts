import test from "node:test";
import assert from "node:assert/strict";
import { AnswerResolutionError, formatAnswer, parseOcrPayload, reconcileAnswer } from "../src/question-options";

function context(lines: string[]) {
  return parseOcrPayload(JSON.stringify({ lines: lines.map((text) => ({ text, confidence: 1 })) }));
}

test("reconciles a correct letter label to canonical visible option text", () => {
  const resolved = reconcileAnswer({ questionText: "What is 2 + 2?", label: "B", text: "4", confidence: 1, raw: "{}" }, context(["What is 2 + 2?", "A. 3", "B. 4", "C. 5"]));
  assert.equal(formatAnswer(resolved), "B — 4");
});

test("valid B with paraphrased answer survives OCR wording differences", () => {
  const resolved = reconcileAnswer({ questionText: "What is 2 + 2?", label: "B", text: "four", confidence: 1, raw: "{}" }, context(["What is 2 + 2?", "A. 3", "B. 4", "C. 5"]));
  assert.equal(formatAnswer(resolved), "B — four");
});

test("maps missing label and malformed duplicated answer text to one exact option", () => {
  const resolved = reconcileAnswer({ questionText: "Q", label: "4", text: "4 — 4", confidence: .8, raw: "{}" }, context(["Q", "A. 3", "B. 4", "C. 5"]));
  assert.equal(resolved.label, "B");
  assert.equal(resolved.text, "4");
  assert.equal(formatAnswer(resolved), "B — 4");
});

test("supports numeric and Russian-style numbered options", () => {
  const resolved = reconcileAnswer({ questionText: "Сколько?", label: "2", text: "семь", confidence: 1, raw: "{}" }, context(["Сколько будет 3 + 4?", "1. шесть", "2. семь", "3. восемь"]));
  assert.equal(formatAnswer(resolved), "2 — семь");
});

test("accepts a single OCR line and parses inline letter options", () => {
  const parsed = context(["What is 2 + 2? A. 3 B. 4 C. 5"]);
  assert.equal(parsed.questionText, "What is 2 + 2?");
  assert.deepEqual(parsed.options, [{ label: "A", text: "3" }, { label: "B", text: "4" }, { label: "C", text: "5" }]);
  assert.equal(formatAnswer(reconcileAnswer({ questionText: "", label: "B", text: "4", confidence: 1, raw: "{}" }, parsed)), "B — 4");
});

test("rejects an ambiguous option match so one bounded repair can run", () => {
  assert.throws(() => reconcileAnswer({ questionText: "Q", label: "", text: "Same", confidence: .5, raw: "{}" }, context(["Q", "A. Same", "B. Same"])), AnswerResolutionError);
});

test("open-ended questions keep answer text without inventing a label", () => {
  const resolved = reconcileAnswer({ questionText: "Name a protocol", label: "", text: "DNS", confidence: .9, raw: "{}" }, context(["Name a protocol", "that resolves host names"]));
  assert.equal(resolved.label, "");
  assert.equal(formatAnswer(resolved), "DNS");
});

test("valid numeric label survives missing OCR options", () => {
  const resolved = reconcileAnswer({ questionText: "Choose one", label: "2", text: "seven", confidence: .9, raw: "{}" }, context(["Choose the correct result"]));
  assert.equal(formatAnswer(resolved), "2 — seven");
});

test("an inferred 1-based ordinal from visually ordered unlabeled choices is preserved without inventing a letter", () => {
  const parsed = context([
    "Which Promise.all behavior is guaranteed?",
    "Each callback runs on a dedicated operating-system thread.",
    "Fulfillment values are emitted immediately in settlement order.",
    "The resulting array preserves the iterable's input order regardless of fulfillment order.",
    "Rejections are ignored when a later promise fulfills."
  ]);
  assert.deepEqual(parsed.options, []);
  const resolved = reconcileAnswer({ questionText: "Which Promise.all behavior is guaranteed?", label: "3", text: "The resulting array preserves the iterable's input order regardless of fulfillment order.", confidence: .95, raw: "{}" }, parsed);
  assert.equal(resolved.label, "3");
  assert.equal(formatAnswer(resolved), "3 — The resulting array preserves the iterable's input order regardless of fulfillment order.");
  assert.doesNotMatch(formatAnswer(resolved), /^[A-Z]\s+—/u);
});

function orderedContext(optionTexts: string[]) {
  return parseOcrPayload(JSON.stringify({ lines: [
    { text: "Sat 18 Jul 00:44", confidence: 1, x: .9, y: .98, width: .09, height: .014 },
    { text: "Build 2026.07", confidence: 1, x: .02, y: .02, width: .08, height: .014 },
    { text: "Which implementation is correct?", confidence: 1, x: .24, y: .82, width: .6, height: .028 },
    ...optionTexts.map((text, index) => ({ text, confidence: .99, x: .25, y: .65 - index * .07, width: .6, height: .025 }))
  ] }));
}

test("invented C on confidently ordered unlabeled OCR canonicalizes an exact third answer to ordinal 3", () => {
  const parsed = orderedContext(["First implementation", "Second implementation", "Correct third implementation", "Fourth implementation"]);
  assert.deepEqual(parsed.options, []);
  assert.deepEqual(parsed.orderedOptions?.map((option) => option.label), ["1", "2", "3", "4"]);
  const resolved = reconcileAnswer({ questionText: "Q", label: "C", text: "Correct third implementation", confidence: .9, raw: "{}" }, parsed);
  assert.equal(formatAnswer(resolved), "3 — Correct third implementation");
});

test("invented C on confidently ordered unlabeled OCR is cleared when useful text cannot be matched", () => {
  const parsed = orderedContext(["First implementation", "Second implementation", "Third implementation", "Fourth implementation"]);
  const resolved = reconcileAnswer({ questionText: "Q", label: "C", text: "Useful paraphrased implementation", confidence: .8, raw: "{}" }, parsed);
  assert.equal(resolved.label, "");
  assert.equal(formatAnswer(resolved), "Useful paraphrased implementation");
});

test("a visibly labeled C option remains C", () => {
  const parsed = context(["Which implementation?", "A. First", "B. Second", "C. Correct third"]);
  const resolved = reconcileAnswer({ questionText: "Q", label: "C", text: "Correct third", confidence: .9, raw: "{}" }, parsed);
  assert.equal(formatAnswer(resolved), "C — Correct third");
});

test("a true numeric 1/2/3 option list remains labeled", () => {
  const parsed = context(["Choose the result", "1. First", "2. Second", "3. Third"]);
  assert.deepEqual(parsed.options.map((option) => option.label), ["1", "2", "3"]);
  assert.equal(formatAnswer(reconcileAnswer({ questionText: "Q", label: "2", text: "Second", confidence: .9, raw: "{}" }, parsed)), "2 — Second");
});

test("unrelated sequential-looking UI noise outside coherent geometry does not create choices", () => {
  const parsed = parseOcrPayload(JSON.stringify({ lines: [
    { text: "Dashboard", confidence: 1, x: .4, y: .9, width: .2, height: .03 },
    { text: "1. Module", confidence: 1, x: .05, y: .8, width: .1, height: .02 },
    { text: "2. Alerts", confidence: 1, x: .75, y: .5, width: .1, height: .04 },
    { text: "3. Build", confidence: 1, x: .2, y: .1, width: .1, height: .015 }
  ] }));
  assert.deepEqual(parsed.options, []);
  assert.deepEqual(parsed.orderedOptions, []);
});

test("clock and build noise plus a same-left question do not shift four unlabeled card ordinals", () => {
  const line = (text: string, x: number, y: number, height = .026) => ({ text, confidence: .98, x, y, width: .62, height });
  const parsed = parseOcrPayload(JSON.stringify({ lines: [
    line("00:47 remaining", .82, .92, .02), line("Build 2026.07", .04, .10, .018), line("Snapshot isolation question", .25, .78, .035),
    line("Dirty reads", .25, .66), line("Write skew", .25, .59), line("Repeatable reads", .25, .52), line("Phantom cleanup", .25, .45),
    line("1. Navigation", .03, .84, .018), line("2. Progress", .82, .30, .018), line("3. Footer", .05, .05, .018)
  ] }));
  assert.deepEqual(parsed.options, []);
  assert.deepEqual(parsed.orderedOptions?.map((choice) => choice.text), ["Dirty reads", "Write skew", "Repeatable reads", "Phantom cleanup"]);
  assert.equal(formatAnswer(reconcileAnswer({ questionText: "Q", label: "3", text: "Write skew", confidence: .9, raw: "{}" }, parsed)), "2 — Write skew");
});

test("a potentially truncated three-choice OCR group does not veto a useful numeric model ordinal", () => {
  const parsed = orderedContext(["Visible second", "Visible third", "Visible fourth"]);
  const resolved = reconcileAnswer({ questionText: "Q", label: "3", text: "Visible third", confidence: .9, raw: "{}" }, parsed);
  assert.equal(formatAnswer(resolved), "3 — Visible third");
});

test("vision numeric ordinal survives contradictory OCR while Spark canonicalizes by OCR", () => {
  const parsed = orderedContext(["First", "Second", "Exact chosen wording", "Fourth"]);
  const completion = { questionText: "Q", label: "2", text: "Exact chosen wording", confidence: .9, raw: "{}" };
  assert.equal(formatAnswer(reconcileAnswer(completion, parsed, { authority: "vision-image" })), "2 — Exact chosen wording");
  assert.equal(formatAnswer(reconcileAnswer(completion, parsed, { authority: "ocr-text" })), "3 — Exact chosen wording");
});

test("vision letter/text OCR conflict preserves useful model result without repair error", () => {
  const parsed = context(["Q", "A. First", "B. Second", "C. Third"]);
  const completion = { questionText: "Q", label: "B", text: "Third", confidence: .8, raw: "{}" };
  assert.equal(formatAnswer(reconcileAnswer(completion, parsed, { authority: "vision-image" })), "B — Third");
  assert.throws(() => reconcileAnswer(completion, parsed, { authority: "ocr-text" }), /conflicts/);
});

test("repair exhaustion keeps useful unlabeled text without inventing a label", () => {
  const resolved = reconcileAnswer({ questionText: "Q", label: "", text: "Useful answer", confidence: .7, raw: "{}" }, context(["Q text", "A. One", "B. Two"]), { finalAttempt: true });
  assert.equal(resolved.label, "");
  assert.equal(formatAnswer(resolved), "Useful answer");
});

test("explicit OCR conflict requests repair once but final valid label and text are accepted", () => {
  const parsed = context(["Q text", "A. One", "B. Two", "C. Three"]);
  const conflict = { questionText: "Q", label: "B", text: "Three", confidence: .7, raw: "{}" };
  assert.throws(() => reconcileAnswer(conflict, parsed), /conflicts/);
  assert.equal(formatAnswer(reconcileAnswer(conflict, parsed, { finalAttempt: true })), "B — Three");
});

test("empty answer remains an actionable reconciliation error", () => {
  assert.throws(() => reconcileAnswer({ questionText: "Q", label: "B", text: "", confidence: 0, raw: "{}" }, context(["Q text", "A. One", "B. Two"]), { finalAttempt: true }), /answer text was empty/);
});

test("local OCR fails clearly when too little text is extracted", () => {
  assert.throws(() => parseOcrPayload('{"lines":[{"text":"Q"}]}'), /could not extract enough question text/);
});
