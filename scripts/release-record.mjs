import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const artifactRelative = `release/CheatyKitty-${packageJson.version}-arm64.dmg`;
const artifact = path.join(root, artifactRelative);
const appAsar = path.join(root, "release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar");
const comparisonPath = path.join(root, "artifacts/capture-proof/comparison.json");
const runtimeEvidenceNames = [
  "gpt-5.6-luna-letter", "gpt-5.6-sol-letter", "gpt-5.3-codex-spark-letter", "gpt-5.3-codex-spark-numeric",
  "gpt-5.6-luna-it-output", "gpt-5.6-luna-it-promises", "gpt-5.6-sol-it-snapshot", "gpt-5.6-sol-it-rust",
  "gpt-5.3-codex-spark-it-typescript", "gpt-5.3-codex-spark-it-sql", "gpt-5.3-codex-spark-it-network"
];
const recordPath = path.join(root, "artifacts/release-record.json");
const negativeProbePath = path.join(root, "artifacts/packaged-negative-probes.json");
const negativeProbeScenarios = ["wrong-executable", "executable-swap", "model-mismatch", "missing-model-metadata", "contradictory-metadata", "sck-hang", "sck-stderr-flood"];

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function mountedAsarSha256() {
  const { stdout } = await run("hdiutil", ["attach", "-readonly", "-nobrowse", "-noverify", artifact], { encoding: "utf8" });
  const mountPoint = stdout.split("\n").map((line) => line.split("\t").at(-1)?.trim()).findLast((value) => value?.startsWith("/Volumes/"));
  if (!mountPoint) throw new Error(`Could not resolve mounted DMG path from: ${stdout}`);
  try { return await sha256(path.join(mountPoint, "CheatyKitty.app/Contents/Resources/app.asar")); }
  finally { await run("hdiutil", ["detach", mountPoint], { encoding: "utf8" }); }
}

async function collect() {
  const [artifactStat, artifactSha256, releaseAppAsarSha256, mountedSha256, comparison, verification, runtimeEvidence, parityResult, privacyResult, negativeProbes] = await Promise.all([
    stat(artifact), sha256(artifact), sha256(appAsar), mountedAsarSha256(),
    readFile(comparisonPath, "utf8").then(JSON.parse),
    run("hdiutil", ["verify", artifact], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }),
    Promise.all(runtimeEvidenceNames.map(async (name) => [name, await sha256(path.join(root, "artifacts/runtime-e2e", `${name}.json`))])),
    run(process.execPath, [path.join(root, "scripts/verify-source-package-parity.mjs"), "--json"], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).then(({ stdout }) => JSON.parse(stdout)),
    run(process.execPath, [path.join(root, "scripts/verify-runtime-evidence-privacy.mjs"), "--json"], { cwd: root, encoding: "utf8" }).then(({ stdout }) => JSON.parse(stdout)),
    readFile(negativeProbePath, "utf8").then(JSON.parse)
  ]);
  const crcMatches = [...`${verification.stdout}\n${verification.stderr}`.matchAll(/verified\s+CRC32 \$([0-9A-F]{8})/g)];
  const hdiutilCrc32 = crcMatches.at(-1)?.[1];
  if (!hdiutilCrc32) throw new Error("hdiutil verify did not return a final CRC32");
  if (mountedSha256 !== releaseAppAsarSha256) throw new Error(`DMG/app.asar parity failed: ${mountedSha256} != ${releaseAppAsarSha256}`);
  if (negativeProbes.appAsarSha256 !== releaseAppAsarSha256 || JSON.stringify(negativeProbes.scenarios?.map((probe) => probe.scenario)) !== JSON.stringify(negativeProbeScenarios) || negativeProbes.scenarios.some((probe) => probe.appAsarSha256 !== releaseAppAsarSha256 || probe.outcome !== "rejected")) throw new Error("Packaged negative probes are incomplete or not bound to the exact app.asar");
  return {
    schemaVersion: 1,
    artifact: artifactRelative,
    sizeBytes: artifactStat.size,
    sha256: artifactSha256,
    hdiutil: { status: "VALID", crc32: hdiutilCrc32 },
    appAsarSha256: releaseAppAsarSha256,
    mountedAppAsarSha256: mountedSha256,
    sourcePackageParity: parityResult,
    runtimeEvidencePrivacy: privacyResult,
    packagedNegativeProbesSha256: await sha256(negativeProbePath),
    packagedRealCaptureE2E: Object.fromEntries(runtimeEvidence),
    sck: {
      filteredVsHiddenMismatchRatio: comparison.filteredVsHiddenMismatchRatio,
      filteredVsHiddenMeanDelta: comparison.filteredVsHiddenMeanDelta,
      rawVisibleVsHiddenMismatchRatio: comparison.rawVisibleVsHiddenMismatchRatio,
      filteredNearBlackRatio: comparison.filteredNearBlackRatio
    }
  };
}

const mode = process.argv[2];
if (!new Set(["--write", "--verify"]).has(mode)) throw new Error("Usage: node scripts/release-record.mjs --write|--verify");
const actual = await collect();
const actualJson = `${JSON.stringify(actual, null, 2)}\n`;
if (mode === "--write") {
  await writeFile(recordPath, actualJson);
  console.log(`Release record finalized after build: ${actual.sha256} (${actual.sizeBytes} bytes), CRC32 ${actual.hdiutil.crc32}`);
} else {
  const recordedJson = await readFile(recordPath, "utf8");
  if (recordedJson !== actualJson) throw new Error(`artifacts/release-record.json does not match the exact DMG\nexpected: ${actualJson}\nrecorded: ${recordedJson}`);
  console.log(`Release record verified against exact DMG and mounted app.asar: ${actual.sha256}`);
}
