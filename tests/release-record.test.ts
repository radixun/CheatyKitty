import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release provenance is finalized after packaging and independently reverified", async () => {
  const [packageJson, script] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("scripts/release-record.mjs", "utf8")
  ]);
  assert.equal(packageJson.scripts["release:record"], "node scripts/release-record.mjs --write");
  assert.equal(packageJson.scripts["release:verify"], "node scripts/release-record.mjs --verify");
  assert.equal(packageJson.build.files.includes("PLAN.md"), false);
  assert.match(script, /hdiutil[\s\S]*verify/);
  assert.match(script, /mountedSha256 !== releaseAppAsarSha256/);
  assert.match(script, /capture-proof\/comparison\.json/);
  assert.match(script, /artifacts\/runtime-e2e/);
  assert.match(script, /verify-source-package-parity/);
  assert.match(script, /verify-runtime-evidence-privacy/);
  assert.match(script, /packaged-negative-probes/);
  assert.match(script, /contradictory-metadata/);
  assert.match(await readFile("scripts/verify-runtime-evidence-privacy.mjs", "utf8"), /appAsarSha256/);
  assert.doesNotMatch(script, /PLAN\.md|release-record:start/);
});
