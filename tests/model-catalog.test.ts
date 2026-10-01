import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { preflightCodexPath } from "../src/codex";
import { listCodexModels, parseCatalogModels } from "../src/model-catalog";

test("catalog preserves future model IDs, effort levels, tiers and input capabilities", () => {
  const models = parseCatalogModels([{ model: "future-v12", supportedReasoningEfforts: [{ reasoningEffort: "future-effort", description: "New level" }], inputModalities: ["text"], serviceTiers: [{ id: "priority", name: "Fast", description: "Faster" }] }, { model: "older-model" }, null]);
  assert.equal(models[0].model, "future-v12");
  assert.equal(models[0].reasoningEfforts[0].effort, "future-effort");
  assert.deepEqual(models[0].inputModalities, ["text"]);
  assert.equal(models[0].serviceTiers[0].id, "priority");
  assert.deepEqual(models[1].inputModalities, ["text", "image"]);
  assert.throws(() => parseCatalogModels({}), /invalid model catalog/);
});

test("model discovery completes the handshake, follows pages, and starts no turns", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-catalog-"));
  const executable = path.join(directory, "codex");
  try {
    await writeFile(executable, `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('codex-cli 1.0.0'); process.exit(0); }
if (process.argv[2] === 'login') process.exit(0);
const readline = require('node:readline'); let initialized = false;
const send = (id, result) => process.stdout.write(JSON.stringify({id, result})+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') send(request.id, {});
  else if (request.method === 'initialized') initialized = true;
  else if (request.method === 'model/list' && initialized) send(request.id, { data: [{model: request.params.cursor ? 'future-two' : 'future-one'}], nextCursor: request.params.cursor ? null : 'page-two' });
  else process.exit(9);
});
`, { mode: 0o700 });
    await chmod(executable, 0o700);
    const models = await listCodexModels(await preflightCodexPath(executable));
    assert.deepEqual(models.map((model) => model.model), ["future-one", "future-two"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
