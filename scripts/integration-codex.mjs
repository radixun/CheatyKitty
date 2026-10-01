import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const selectedModel = process.argv[2] || "gpt-5.6-luna";
const selectedEffort = process.argv[3] || "medium";
const variant = process.argv[4] === "numeric" ? "numeric" : "letter";

function spawnChecked(executable, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Synthetic PNG renderer failed (${code}): ${stderr}`)));
  });
}

const isolatedRoot = await mkdtemp(path.join(tmpdir(), "cheatykitty-e2e-"));
const codexTmp = path.join(isolatedRoot, "codex-tmp");
const pngPath = path.join(isolatedRoot, "synthetic-question.png");
await mkdir(codexTmp, { mode: 0o700 });

try {
  const electron = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const renderer = path.resolve("scripts/generate-synthetic-png.cjs");
  await spawnChecked(electron, [renderer, pngPath, variant]);
  const png = await readFile(pngPath);
  if (png.length < 100) throw new Error("Synthetic PNG is unexpectedly empty");

  process.env.TMPDIR = codexTmp;
  const { preflightCodex, runCodex } = require("../dist/codex.js");
  const executable = await preflightCodex("");
  console.log(`E2E checkpoint: invoking ${executable.path} through runCodex with ${png.length}-byte PNG; model=${selectedModel}; reasoning=${selectedEffort}`);
  const invocations = [];
  const answer = await runCodex(png, executable, 180, selectedModel, selectedEffort, {
    ocrExecutable: process.env.CHEATYKITTY_OCR_HELPER || path.resolve("dist/native/vision-ocr"),
    onInvocation: (proof) => invocations.push(proof)
  });
  console.log("E2E checkpoint: runCodex returned; validating raw and parsed JSON");

  const raw = JSON.parse(answer.raw);
  if (!raw || typeof raw !== "object") throw new Error("Codex raw output is not a JSON object");
  if (!answer.questionText || !answer.label || !answer.text || answer.confidence === null) {
    throw new Error(`Parsed answer is incomplete: ${JSON.stringify(answer)}`);
  }
  const expected = variant === "numeric" ? { label: "2", text: "7" } : { label: "B", text: "4" };
  if (answer.label.toUpperCase() !== expected.label || answer.text.trim() !== expected.text) {
    throw new Error(`Unexpected synthetic answer: ${answer.label} — ${answer.text}`);
  }
  if (!invocations.length || invocations.some((proof) => proof.model !== selectedModel || proof.reasoningEffort !== selectedEffort || !proof.prompt.includes(proof.ocrText))) throw new Error(`Invocation proof does not preserve selected model/effort/OCR text: ${JSON.stringify(invocations.map(({ model, reasoningEffort, imageAttached, attempt }) => ({ model, reasoningEffort, imageAttached, attempt })))}`);
  const spark = selectedModel === "gpt-5.3-codex-spark";
  if (invocations.some((proof) => proof.imageAttached === spark || proof.args.includes("--image") === spark || (spark && proof.args.includes(pngPath)))) throw new Error(`Input mode mismatch for ${selectedModel}`);
  console.log(`E2E invocation proof: ${JSON.stringify(invocations.map((proof) => { const modelIndex = proof.args.indexOf("--model"); return { attempt: proof.attempt, model: proof.model, reasoningEffort: proof.reasoningEffort, argvModelSegment: proof.args.slice(modelIndex, modelIndex + 4), imageAttached: proof.imageAttached, hasOcrText: proof.prompt.includes(proof.ocrText), hasImageFlag: proof.args.includes("--image"), inputMode: proof.imageAttached ? "image+local-ocr" : "local-ocr-text-only" }; }))}`);

  const leftovers = await readdir(codexTmp);
  if (leftovers.length !== 0) throw new Error(`Temporary artifacts remain after success: ${leftovers.join(", ")}`);
  console.log(`Codex E2E passed (${variant}): ${answer.label} — ${answer.text}; confidence=${answer.confidence}`);
  console.log("Codex raw output is valid JSON; isolated Codex temp directory is empty after success.");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
