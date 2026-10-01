import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toViewModel, compactMessage, displayAnswer } = require("../src/renderer/view-model.js") as { toViewModel: (state: Record<string, unknown>) => any; compactMessage: (value: unknown, maximumLength?: number) => string; displayAnswer: (answer: Record<string, unknown>) => string };

test("busy capture retains old question and answer and overlays recognition only", () => {
  const previous = toViewModel({ kind: "answer", model: "5.6 Sol · Medium", answer: { questionText: "Old question", label: "C", text: "Old answer", confidence: .8 } });
  const retainedAnswer = { questionText: "Old question", label: "C", text: "Old answer", confidence: .8 };
  const busy = toViewModel({ kind: "capturing", model: "5.6 Sol · Medium", retainedAnswer });
  assert.match(previous.question.text, /Old question/);
  assert.match(previous.answer.text, /Old answer/);
  assert.equal(busy.question.status, "Recognizing new…");
  assert.equal(busy.answer.status, "Previous answer");
  assert.equal(busy.question.busy, true);
  assert.equal(busy.answer.busy, false);
  assert.match(`${busy.question.text} ${busy.answer.text}`, /Old question.*Old answer/);
  assert.equal(busy.question.retained, true);
});

test("thinking begins recognition and solving only after capture", () => {
  const thinking = toViewModel({ kind: "thinking", model: "gpt-5.6-sol" });
  assert.equal(thinking.question.status, "Recognizing question…");
  assert.equal(thinking.answer.status, "Solving…");
  assert.equal(thinking.question.busy, true);
  assert.equal(thinking.answer.busy, true);
});

test("very long main errors preserve useful beginning and ending without breaking workArea layout", () => {
  const raw = `START ${"diagnostic ".repeat(100)} END`;
  const compact = compactMessage(raw, 160);
  assert.ok(compact.length <= 160);
  assert.match(compact, /^START/);
  assert.match(compact, /END$/);
  assert.match(compact, /details omitted/);
  const error = toViewModel({ kind: "error", model: "Default", message: raw });
  assert.ok(error.question.text.length <= 420);
});

test("result shows recognized question and selected answer without reason", () => {
  const result = toViewModel({ kind: "answer", model: "Default — 5.6 Luna · Medium", answer: { questionText: "What is 2 + 2?", label: "B", text: "4", confidence: 1, reason: "legacy" } });
  assert.equal(result.question.text, "What is 2 + 2?");
  assert.equal(result.answer.text, "B — 4");
  assert.doesNotMatch(JSON.stringify(result), /legacy|reason/i);
});

test("error and cancellation populate both columns without stale result", () => {
  const error = toViewModel({ kind: "error", model: "Default", message: "Codex unavailable" });
  const cancelled = toViewModel({ kind: "cancelled", model: "Default" });
  assert.equal(error.question.status, "Error");
  assert.equal(error.answer.status, "Error");
  assert.equal(cancelled.question.status, "Cancelled");
  assert.equal(cancelled.answer.status, "Cancelled");
});

test("answer-only error exposes actionable root cause instead of the generic answer failure", () => {
  const message = "Spark needs readable local OCR. Try a larger capture area or clearer text.";
  const empty = toViewModel({ kind: "error", model: "Spark", message, resultLayout: "answer-only" });
  assert.equal(empty.answer.text, message);
  assert.doesNotMatch(empty.answer.text, /Could not solve this capture/);
  const retained = toViewModel({ kind: "error", model: "Spark", message, resultLayout: "answer-only", retainedAnswer: { questionText: "Old Q", label: "A", text: "Old A", confidence: 1 } });
  assert.equal(retained.answer.text, "A — Old A");
  assert.match(retained.answer.status, /Spark needs readable local OCR/);
});

test("error and cancellation retain the last successful result", () => {
  const retainedAnswer = { questionText: "Stable question", label: "A", text: "Stable answer", confidence: .9 };
  for (const state of [{ kind: "error", message: "timeout" }, { kind: "cancelled" }]) {
    const view = toViewModel({ ...state, retainedAnswer, model: "Default" });
    assert.equal(view.question.text, "Stable question");
    assert.equal(view.answer.text, "A — Stable answer");
  }
});

test("answer-only preserves full Q/A in state while selecting one-column layout", () => {
  const answer = { questionText: "Internally retained question", label: "D", text: "A long answer", confidence: .7 };
  const view = toViewModel({ kind: "answer", answer, resultLayout: "answer-only" });
  assert.equal(view.layout, "answer-only");
  assert.equal(view.question.text, answer.questionText);
  assert.equal(view.answer.text, "D — A long answer");
});

test("answer-only capturing overlays visible Answer while preserving the retained result", () => {
  const retainedAnswer = { questionText: "Stable question", label: "B", text: "Stable answer", confidence: .8 };
  const view = toViewModel({ kind: "capturing", retainedAnswer, resultLayout: "answer-only" });
  assert.equal(view.answer.text, "B — Stable answer");
  assert.equal(view.answer.busy, true);
  assert.equal(view.answer.status, "");
  assert.equal(view.answer.retained, true);
  assert.equal(view.answer.progress, "Solving new answer…");
  assert.deepEqual([view.answer.status, view.answer.progress].filter(Boolean), ["Solving new answer…"]);
});

test("answer-only thinking exposes one visible solving progress string", () => {
  const retainedAnswer = { questionText: "Stable question", label: "B", text: "Stable answer", confidence: .8 };
  const view = toViewModel({ kind: "thinking", retainedAnswer, resultLayout: "answer-only" });
  assert.equal(view.answer.status, "");
  assert.equal(view.answer.progress, "Solving new answer…");
  assert.equal([view.answer.status, view.answer.progress].filter((value) => value === "Solving new answer…").length, 1);
});

test("answer-only without a retained result uses the same single solving phase in Capturing and Thinking", () => {
  for (const kind of ["capturing", "thinking"] as const) {
    const view = toViewModel({ kind, resultLayout: "answer-only" });
    assert.equal(view.answer.status, "");
    assert.deepEqual([view.answer.status, view.answer.progress].filter(Boolean), ["Solving new answer…"]);
  }
});

test("display formatter collapses malformed answer — answer duplication", () => {
  assert.equal(displayAnswer({ label: "B", text: "4 — 4" }), "B — 4");
  assert.equal(displayAnswer({ label: "answer", text: "answer" }), "answer");
});

test("dedicated live announcement is concise and never repeats retained Q/A on failure", () => {
  const retainedAnswer = { questionText: "SECRET OLD QUESTION", label: "D", text: "SECRET OLD ANSWER", confidence: .7 };
  const view = toViewModel({ kind: "error", message: `START ${"diagnostic ".repeat(100)} END`, retainedAnswer });
  assert.match(view.announcement, /^New run failed\. START/);
  assert.match(view.announcement, /END$/);
  assert.ok(view.announcement.length <= 196);
  assert.doesNotMatch(view.announcement, /SECRET OLD/);
});

test("retained Manual and Auto progress never changes the saved Q/A content", () => {
  const retainedAnswer = { questionText: "Readable question", label: "C", text: "Readable answer", confidence: .9 };
  for (const mode of ["manual", "auto"]) {
    for (const kind of ["capturing", "thinking"]) {
      const view = toViewModel({ kind, mode, autoActive: mode === "auto", retainedAnswer, resultLayout: "question-answer" });
      assert.equal(view.question.text, retainedAnswer.questionText);
      assert.equal(view.answer.text, "C — Readable answer");
      assert.equal(view.question.retained, true);
      assert.equal(view.answer.retained, true);
    }
  }
});
