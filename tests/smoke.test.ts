import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("source smoke resolves the lazy Electron runtime through its package entry point", async () => {
  const script = await readFile("scripts/smoke.mjs", "utf8");
  assert.match(script, /await import\("electron"\)/);
  assert.doesNotMatch(script, /node_modules\/electron\/dist/);
  assert.match(script, /child\.on\("error"/);
});
