import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPrivacySafeObject } from "../scripts/evidence-privacy.mjs";

test("recursive persisted-evidence guard rejects raw content keys and values", () => {
  const secret = "UNIQUE VISIBLE OCR SECRET";
  assert.throws(() => assertPrivacySafeObject({ nested: { answerText: "safe-looking" } }), /forbidden persisted content key/);
  assert.throws(() => assertPrivacySafeObject({ nested: { digest: secret } }, [secret]), /persisted raw runtime content/);
  assert.doesNotThrow(() => assertPrivacySafeObject({ schemaVersion: 2, resultSha256: "a".repeat(64), resultCharacters: 12, inputMode: "image+local-ocr" }));
});

test("production proof telemetry persists digests, never captured QA content", async () => {
  const source = await readFile("src/main.ts", "utf8");
  assert.doesNotMatch(source, /writeHotkeyProof\([^\n]*answer\.text/);
  assert.doesNotMatch(source, /writeHotkeyProof\([^\n]*answer\.questionText/);
  assert.doesNotMatch(source, /writeHotkeyProof\("run-error"[^\n]*message:/);
  assert.match(source, /resultSha256/);
  assert.match(source, /querySha256/);
});
