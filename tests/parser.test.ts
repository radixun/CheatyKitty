import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexAnswer } from "../src/parser";

test("parses schema-shaped JSON", () => {
  assert.deepEqual(parseCodexAnswer('{"question_text":"What is France’s capital?","option_label":"B","option_number":"","answer_text":"Paris","confidence":0.92}'), {
    questionText: "What is France’s capital?", label: "B", text: "Paris", confidence: 0.92,
    raw: '{"question_text":"What is France’s capital?","option_label":"B","option_number":"","answer_text":"Paris","confidence":0.92}'
  });
});

test("uses numeric option when letter is empty", () => {
  assert.equal(parseCodexAnswer('{"question_text":"Q","option_label":"","option_number":"2","answer_text":"Seven","confidence":1}').label, "2");
});

test("ignores legacy reason output", () => {
  const answer = parseCodexAnswer('{"question_text":"Q?","answer_label":"A","answer_text":"One","confidence":1,"reason":"Do not expose"}');
  assert.equal(answer.questionText, "Q?");
  assert.equal("reason" in answer, false);
});

test("falls back to a concise raw answer", () => {
  const answer = parseCodexAnswer("C — 42\nIt is the computed result.");
  assert.equal(answer.label, "C");
  assert.equal(answer.text, "42");
  assert.equal(answer.questionText, "");
  assert.equal("reason" in answer, false);
});
