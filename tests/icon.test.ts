import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("every iconutil representation exactly matches an independent canonical downscale", async () => {
  await run(process.execPath, ["scripts/prepare-icon.mjs"]);
  await run(process.execPath, ["scripts/verify-icon.mjs"]);
  const audit = JSON.parse(await readFile("artifacts/cheatykitty-icon-audit.json", "utf8"));
  assert.equal(audit.metrics.length, 10);
  for (const metric of audit.metrics) {
    assert.equal(metric.mismatchedSamples, 0, metric.file);
    assert.equal(metric.maximumError, 0, metric.file);
  }
  for (const label of ["16x16 1x", "32x32 1x"]) {
    const metric = audit.metrics.find((candidate: { label: string }) => candidate.label === label);
    assert.ok(metric, `${label} must be extracted and audited`);
    assert.equal(metric.rootMeanSquareError, 0);
  }
});
