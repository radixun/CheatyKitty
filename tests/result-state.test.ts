import test from "node:test";
import assert from "node:assert/strict";
import { commitCurrentResult } from "../src/result-state";

const oldResult = { questionText: "Old", label: "A", text: "Old answer", confidence: .8 };
const newResult = { questionText: "New", label: "B", text: "New answer", confidence: .9 };

test("success then busy cancel/error leaves last successful result unchanged", () => {
  assert.equal(commitCurrentResult(oldResult, newResult, 2, 2, true), oldResult);
  assert.equal(commitCurrentResult(oldResult, { ...newResult, questionText: "" }, 2, 2, false), oldResult);
});

test("cancelled A then B success rejects late A by run id", () => {
  const afterB = commitCurrentResult(oldResult, newResult, 2, 2, false);
  const lateA = commitCurrentResult(afterB, { ...newResult, text: "Late A" }, 1, 2, false);
  assert.equal(afterB, newResult);
  assert.equal(lateA, afterB);
});
