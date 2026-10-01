import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assertPrivacySafeObject } from "./evidence-privacy.mjs";

const root = path.resolve(import.meta.dirname, "..");
const evidenceDirectory = path.join(root, "artifacts/runtime-e2e");
const expectedNames = [
  "gpt-5.6-luna-letter", "gpt-5.6-sol-letter", "gpt-5.3-codex-spark-letter", "gpt-5.3-codex-spark-numeric",
  "gpt-5.6-luna-it-output", "gpt-5.6-luna-it-promises", "gpt-5.6-sol-it-snapshot", "gpt-5.6-sol-it-rust",
  "gpt-5.3-codex-spark-it-typescript", "gpt-5.3-codex-spark-it-sql", "gpt-5.3-codex-spark-it-network"
];
const expectedNegativeScenarios = ["wrong-executable", "executable-swap", "model-mismatch", "missing-model-metadata", "contradictory-metadata", "sck-hang", "sck-stderr-flood"];
const files = (await readdir(evidenceDirectory)).filter((name) => name.endsWith(".json")).sort();
const expectedFiles = expectedNames.map((name) => `${name}.json`).sort();
if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) throw new Error(`Runtime evidence set differs from the exact 11 records: ${JSON.stringify(files)}`);
const expectedAppAsarSha256 = createHash("sha256").update(await readFile(path.join(root, "release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar"))).digest("hex");
for (const file of files) {
  const value = JSON.parse(await readFile(path.join(evidenceDirectory, file), "utf8"));
  assertPrivacySafeObject(value);
  if (value.schemaVersion !== 2 || value.appAsarSha256 !== expectedAppAsarSha256 || !/^[a-f0-9]{64}$/.test(value.captureSha256 ?? "") || !/^[a-f0-9]{64}$/.test(value.resultSha256 ?? "")) {
    throw new Error(`${file}: incomplete privacy-safe schema`);
  }
}
const negativeProbes = JSON.parse(await readFile(path.join(root, "artifacts/packaged-negative-probes.json"), "utf8"));
assertPrivacySafeObject(negativeProbes);
if (negativeProbes.appAsarSha256 !== expectedAppAsarSha256 || JSON.stringify(negativeProbes.scenarios?.map((probe) => probe.scenario)) !== JSON.stringify(expectedNegativeScenarios)) throw new Error("Packaged negative probe privacy/provenance record is incomplete");
const report = { status: "PASS", schemaVersion: 2, recordCount: files.length, appAsarSha256: expectedAppAsarSha256 };
if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(report));
else console.log(`Privacy forensic PASS: ${files.length} runtime JSON records contain bounded metadata/hashes only.`);
