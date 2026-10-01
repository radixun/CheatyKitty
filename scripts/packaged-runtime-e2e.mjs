import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const model = process.argv[2] || "gpt-5.6-luna";
const requestedVariant = process.argv[3] || "letter";
const scenarios = {
  letter: { label: "B", text: "4", question: "What is 2 + 2?" },
  numeric: { label: "2", text: "7", question: "What is 3 + 4?" },
  "it-output": { label: "3", text: "It throws a TypeError because the value contains a circular reference.", question: "What does this JavaScript print" },
  "it-promises": { label: "3", text: "The resulting array preserves the iterable's input order regardless of fulfillment order.", question: "Which statement about Promise.all" },
  "it-snapshot": { label: "2", text: "Write skew between transactions that update different rows after reading the same invariant.", question: "Which anomaly can still occur under snapshot isolation" },
  "it-rust": { label: "4", text: "The guard remains live across a suspension point and may not implement Send.", question: "Why can holding std::sync::MutexGuard" },
  "it-typescript": { label: "3", text: "The compatible overload signatures; the implementation signature is not directly callable.", question: "When TypeScript checks a call to an overloaded function" },
  "it-sql": { label: "4", text: "An expression index on lower(email).", question: "A PostgreSQL query filters" },
  "it-network": { label: "1", text: "The persist timer sends window probes.", question: "A TCP receiver advertises a zero window" }
};
const variant = Object.hasOwn(scenarios, requestedVariant) ? requestedVariant : "letter";
const degradedOcr = process.argv[4] === "degraded-ocr";
const supported = new Set(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.3-codex-spark"]);
if (!supported.has(model)) throw new Error(`Unsupported E2E model: ${model}`);
const expected = scenarios[variant];
const shortcutKey = model === "gpt-5.6-luna" ? "6" : model === "gpt-5.6-sol" ? "7" : variant === "numeric" ? "9" : "8";
const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-packaged-runtime-"));
const ready = path.join(directory, "background-ready.json");
const proof = path.join(directory, "runtime-proof.jsonl");
const realCapture = path.join(directory, "real-screen-capture.png");
const userData = path.join(directory, "user-data");
const electron = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const appExecutable = path.resolve("release/mac-arm64/CheatyKitty.app/Contents/MacOS/CheatyKitty");
const sck = path.resolve("release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar.unpacked/dist/native/sck-capture");
const ocr = path.resolve("release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar.unpacked/dist/native/vision-ocr");
const proofOcr = path.join(directory, "degraded-ocr");
const extractedAsar = path.join(directory, "app-asar");
const appAsarPath = path.resolve("release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar");
const degradedOcrText = "Partial OCR question without usable option labels";
const { resolveCodexPath } = await import(pathToFileURL(path.resolve("dist/codex.js")).href);
const codexExecutable = process.env.CHEATYKITTY_CODEX_E2E_PATH || await resolveCodexPath("");
let background;
let application;

async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

try {
  await mkdir(userData);
  await run(path.resolve("node_modules/.bin/asar"), ["extract", appAsarPath, extractedAsar]);
  const appAsarSha256 = createHash("sha256").update(await readFile(appAsarPath)).digest("hex");
  const packagedParserPath = path.join(extractedAsar, "dist/question-options.js");
  const [packagedParserBytes, workspaceParserBytes] = await Promise.all([readFile(packagedParserPath), readFile(path.resolve("dist/question-options.js"))]);
  const packagedParserSha256 = createHash("sha256").update(packagedParserBytes).digest("hex");
  const workspaceParserSha256 = createHash("sha256").update(workspaceParserBytes).digest("hex");
  if (packagedParserSha256 !== workspaceParserSha256) throw new Error(`Packaged parser parity failed: ${packagedParserSha256} != ${workspaceParserSha256}`);
  const { parseOcrPayload, reconcileAnswer, formatAnswer } = await import(`${pathToFileURL(packagedParserPath).href}?sha=${packagedParserSha256}`);
  const line = (text, x, y, height = .026) => ({ text, confidence: .98, x, y, width: .62, height });
  const unlabeledNoise = parseOcrPayload(JSON.stringify({ lines: [
    line("00:47 remaining", .82, .92, .02), line("Build 2026.07", .04, .10, .018), line("Snapshot isolation question", .25, .78, .035),
    line("Dirty reads", .25, .66), line("Write skew", .25, .59), line("Repeatable reads", .25, .52), line("Phantom cleanup", .25, .45),
    line("1. Navigation", .03, .84, .018), line("2. Progress", .82, .30, .018), line("3. Footer", .05, .05, .018)
  ] }));
  if (unlabeledNoise.options.length !== 0 || unlabeledNoise.orderedOptions?.length !== 4 || unlabeledNoise.orderedOptions[1]?.text !== "Write skew") throw new Error("Packaged parser failed clock/build/scattered-noise snapshot isolation");
  const scattered = parseOcrPayload(JSON.stringify({ lines: [line("Coherent question tail", .25, .8), line("1. Nav", .02, .7), line("2. Status", .8, .4), line("3. Footer", .12, .1)] }));
  if (scattered.options.length || scattered.orderedOptions?.length) throw new Error("Packaged parser treated unrelated sequential UI noise as choices");
  for (const visible of [["A. one", "B. two", "C. three"], ["1. one", "2. two", "3. three"]]) {
    const parsed = parseOcrPayload(JSON.stringify({ lines: [line("Visible labels question", .2, .9), ...visible.map((text, index) => line(text, .2, .75 - index * .08))] }));
    if (parsed.options.length !== 3 || parsed.questionText !== "Visible labels question" || parsed.questionText.includes("three")) throw new Error("Packaged parser lost coherent visible labels or retained the choice tail in the query");
  }
  const authorityContext = parseOcrPayload(JSON.stringify({ lines: [line("Authority question", .24, .82, .035), line("First", .25, .66), line("Second", .25, .59), line("Exact chosen wording", .25, .52), line("Fourth", .25, .45)] }));
  const contradictoryCompletion = { questionText: "Q", label: "2", text: "Exact chosen wording", confidence: .9, raw: "{}" };
  if (formatAnswer(reconcileAnswer(contradictoryCompletion, authorityContext, { authority: "vision-image" })) !== "2 — Exact chosen wording") throw new Error("Packaged parser allowed OCR to rewrite a vision numeric ordinal");
  if (formatAnswer(reconcileAnswer(contradictoryCompletion, authorityContext, { authority: "ocr-text" })) !== "3 — Exact chosen wording") throw new Error("Packaged parser lost Spark OCR-authoritative canonicalization");
  await writeFile(path.join(userData, "settings.json"), JSON.stringify({ codexPath: "", timeoutSeconds: 180, captureMode: "display", model, reasoningEffort: "medium", autoIntervalSeconds: 5, overlayOpacity: 1, interactionMode: "manual", manualShortcut: `CommandOrControl+Alt+Shift+${shortcutKey}`, resultLayout: "answer-only" }, null, 2));
  background = spawn(electron, ["scripts/runtime-e2e-background.cjs", variant], { env: { ...process.env, CHEATYKITTY_RUNTIME_BACKGROUND_READY: ready }, stdio: ["ignore", "pipe", "pipe"] });
  await waitFor(() => readFile(ready, "utf8"), 15_000, "the real LMS background");
  const captured = await run(sck, ["0", "0"], { encoding: "buffer", maxBuffer: 200 * 1024 * 1024 });
  await writeFile(realCapture, captured.stdout);
  const captureSha256 = createHash("sha256").update(captured.stdout).digest("hex");
  const ocrResult = await run(ocr, [realCapture], { encoding: "utf8" });
  const ocrPayload = JSON.parse(ocrResult.stdout);
  const extractedText = ocrPayload.lines.map((line) => line.text).join("\n");
  if (!extractedText.includes(expected.question)) {
    throw new Error(`Packaged OCR missed the expected query; capture=${captureSha256}, ocr=${createHash("sha256").update(extractedText).digest("hex")}`);
  }
  const independentlyParsedContext = parseOcrPayload(ocrResult.stdout);
  if (variant === "it-snapshot" || (variant.startsWith("it-") && model === "gpt-5.3-codex-spark")) {
    const ordered = independentlyParsedContext.orderedOptions ?? [];
    if (ordered.length !== 4 || ordered[Number(expected.label) - 1]?.text !== expected.text) throw new Error(`Packaged OCR did not preserve the expected confident four-choice order; orderedCount=${ordered.length}, capture=${captureSha256}`);
  }
  if (degradedOcr) {
    if (model === "gpt-5.3-codex-spark") throw new Error("Spark cannot use the degraded-OCR vision fallback proof");
    await writeFile(proofOcr, `#!/bin/sh\nprintf '%s' '${JSON.stringify({ lines: [{ text: degradedOcrText, confidence: 0.2 }] })}'\n`);
    await chmod(proofOcr, 0o700);
  }
  let stderr = "";
  application = spawn(appExecutable, [`--user-data-dir=${userData}`], { env: { ...process.env, CODEX_PATH: codexExecutable, CHEATYKITTY_HOTKEY_PROOF_FILE: proof, CHEATYKITTY_HOTKEY_PROOF_TRIGGER: "1", ...(degradedOcr ? { CHEATYKITTY_OCR_PROOF_HELPER: proofOcr } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
  application.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const events = await waitFor(async () => {
    const parsed = (await readFile(proof, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    return parsed.some((event) => event.event === "run-complete") ? parsed : null;
  }, 210_000, "the packaged production capture/Codex result");
  const invocation = events.find((event) => event.event === "codex-invocation");
  const completion = events.find((event) => event.event === "run-complete");
  if (!invocation || completion?.outcome !== "answer") throw new Error(`Packaged runtime failed: ${JSON.stringify({ events, stderr })}`);
  if (invocation.model !== model || invocation.reasoningEffort !== "medium") throw new Error(`Wrong model argv telemetry: ${JSON.stringify(invocation)}`);
  const expectedResultSha256 = createHash("sha256").update(expected.text).digest("hex");
  if (completion.label !== expected.label || completion.resultSha256 !== expectedResultSha256 || completion.resultCharacters !== expected.text.length) throw new Error(`Wrong formatted result metadata: ${JSON.stringify({ selectedLabel: completion.label, resultSha256: completion.resultSha256, expectedResultSha256 })}`);
  if (model === "gpt-5.3-codex-spark") {
    if (invocation.imageAttached || invocation.hasImageFlag || invocation.input !== "local-ocr-text-only" || !invocation.ocrAvailable || invocation.ocrCharacters < 8) throw new Error(`Spark was not OCR text-only: ${JSON.stringify(invocation)}`);
  } else {
    if (!invocation.imageAttached || !invocation.hasImageFlag || invocation.input !== "image+local-ocr") throw new Error(`Vision model lost image input: ${JSON.stringify(invocation)}`);
    if (degradedOcr && (invocation.ocrCharacters !== degradedOcrText.length || invocation.ocrSha256 !== createHash("sha256").update(degradedOcrText).digest("hex"))) throw new Error(`Vision model did not use the intentionally degraded OCR context: ${JSON.stringify(invocation)}`);
  }
  const evidenceDirectory = path.resolve("artifacts/runtime-e2e");
  await mkdir(evidenceDirectory, { recursive: true });
  const orderedChoiceSha256s = (independentlyParsedContext.orderedOptions ?? []).map((choice) => createHash("sha256").update(choice.text).digest("hex"));
  const ocrSha256 = createHash("sha256").update(extractedText).digest("hex");
  const safeInvocation = {
    attempt: invocation.attempt, model: invocation.model, reasoningEffort: invocation.reasoningEffort, inputMode: invocation.input,
    imageAttached: invocation.imageAttached, imageFlagPresent: invocation.hasImageFlag, ocrAvailable: invocation.ocrAvailable,
    ocrCharacters: invocation.ocrCharacters, ocrSha256: invocation.ocrSha256, recognizedLabelCount: invocation.recognizedLabelCount,
    recognizedLabelsSha256: invocation.recognizedLabelsSha256, orderedChoiceCount: invocation.orderedChoiceCount,
    orderedChoiceSha256s: invocation.orderedChoiceSha256s
  };
  const evidence = {
    schemaVersion: 2, model, variant, inputMode: safeInvocation.inputMode,
    ocrMode: degradedOcr ? "degraded" : "packaged-vision", captureSha256, captureRetained: false,
    appAsarSha256, packagedParserSha256, parserParity: true, ocrCharacters: extractedText.length, ocrLineCount: ocrPayload.lines.length, ocrSha256,
    recognizedLabelCount: independentlyParsedContext.options.length,
    recognizedLabelsSha256: createHash("sha256").update(independentlyParsedContext.options.map((choice) => choice.label).join("\n")).digest("hex"),
    orderedChoiceCount: orderedChoiceSha256s.length, orderedChoiceSha256s, expectedOrdinal: Number(expected.label) || null,
    invocationMetadata: safeInvocation, outcome: completion.outcome, selectedLabel: completion.label,
    resultCharacters: completion.resultCharacters, resultSha256: completion.resultSha256,
    queryCharacters: completion.queryCharacters, querySha256: completion.querySha256, confidence: completion.confidence
  };
  await writeFile(path.join(evidenceDirectory, `${model}-${variant}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Packaged real-capture E2E passed: ${model} ${variant}; selected=${completion.label}; resultSha256=${completion.resultSha256}; captureSha256=${captureSha256}; packagedParserSha256=${packagedParserSha256}`);
} finally {
  for (const child of [application, background]) {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1500))]);
    }
  }
  await rm(directory, { recursive: true, force: true });
}
