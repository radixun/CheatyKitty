import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "cheatykitty-parity-"));
const freshDist = path.join(temporary, "dist");
const extracted = path.join(temporary, "asar");
const asarPath = path.join(root, "release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar");

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? filesBelow(path.join(directory, entry.name), path.join(prefix, entry.name))
    : [path.join(prefix, entry.name)]));
  return nested.flat().sort();
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function equalFiles(left, right, label) {
  const [a, b] = await Promise.all([readFile(left), readFile(right)]);
  if (!a.equals(b)) throw new Error(`${label} parity failed: ${digest(a)} != ${digest(b)}`);
  return digest(a);
}

try {
  await run(path.join(root, "node_modules/.bin/tsc"), ["--outDir", freshDist], { cwd: root });
  await run(path.join(root, "node_modules/.bin/asar"), ["extract", asarPath, extracted], { cwd: root });
  const compiledFiles = (await filesBelow(freshDist)).filter((file) => file.endsWith(".js"));
  const compiledHashes = [];
  for (const relative of compiledFiles) {
    const fresh = path.join(freshDist, relative);
    const current = path.join(root, "dist", relative);
    const packaged = path.join(extracted, "dist", relative);
    const hash = await equalFiles(fresh, current, `fresh/current dist ${relative}`);
    await equalFiles(fresh, packaged, `fresh/package ASAR ${relative}`);
    compiledHashes.push(`${relative}:${hash}`);
  }
  const rendererFiles = await filesBelow(path.join(root, "src/renderer"));
  for (const relative of rendererFiles) {
    const source = path.join(root, "src/renderer", relative);
    await equalFiles(source, path.join(root, "dist/renderer", relative), `renderer source/dist ${relative}`);
    await equalFiles(source, path.join(extracted, "dist/renderer", relative), `renderer source/package ${relative}`);
  }
  for (const relative of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    await equalFiles(path.join(root, relative), path.join(extracted, relative), `package surface ${relative}`);
  }
  const [sourcePackage, packagedPackage] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(extracted, "package.json"), "utf8").then(JSON.parse)
  ]);
  const runtimePackageKeys = ["name", "version", "private", "description", "author", "main", "license", "engines"];
  const expectedRuntimePackage = Object.fromEntries(runtimePackageKeys.map((key) => [key, sourcePackage[key]]));
  if (JSON.stringify(packagedPackage) !== JSON.stringify(expectedRuntimePackage)) throw new Error("electron-builder runtime package metadata differs from the exact source projection");
  const helperHashes = {};
  for (const helper of ["sck-capture", "vision-ocr"]) {
    helperHashes[helper] = await equalFiles(path.join(root, "dist/native", helper), path.join(root, "release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar.unpacked/dist/native", helper), `native helper ${helper}`);
  }
  const packagedParser = await readFile(path.join(extracted, "dist/question-options.js"), "utf8");
  for (const marker of ["bestSequentialCluster", "<= .008", ">= .8", "vision-image", "orderedMatches.length === 1"]) {
    if (!packagedParser.includes(marker)) throw new Error(`Packaged parser is missing current sequential/geometry marker: ${marker}`);
  }
  const sourceFiles = [
    ...(await filesBelow(path.join(root, "src"))).map((file) => path.join("src", file)),
    ...(await filesBelow(path.join(root, "native"))).map((file) => path.join("native", file)),
    "package.json", "tsconfig.json"
  ].sort();
  const sourceTreeHash = createHash("sha256");
  for (const relative of sourceFiles) sourceTreeHash.update(relative).update("\0").update(await readFile(path.join(root, relative))).update("\0");
  const report = {
    status: "PASS", compiledFileCount: compiledFiles.length, rendererFileCount: rendererFiles.length,
    sourceTreeSha256: sourceTreeHash.digest("hex"), compiledSetSha256: digest(compiledHashes.join("\n")),
    packagedParserSha256: digest(packagedParser), helperSha256: helperHashes,
    parserMarkers: { sequentialCluster: true, strictLeftEdge008: true, coherentHeightRatio: true, explicitAnswerAuthority: true, orderedCanonicalization: true }
  };
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(report));
  else console.log(`Source/dist/ASAR parity PASS: ${report.sourceTreeSha256}; packaged parser ${report.packagedParserSha256}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
