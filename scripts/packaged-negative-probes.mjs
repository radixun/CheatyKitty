import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-packaged-negative-"));
const appExecutable = path.join(root, "release/mac-arm64/CheatyKitty.app/Contents/MacOS/CheatyKitty");
const appAsarPath = path.join(root, "release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar");
const electron = path.join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const { resolveCodexPath } = await import(pathToFileURL(path.join(root, "dist/codex.js")).href);
const realCodex = process.env.CHEATYKITTY_CODEX_E2E_PATH || await resolveCodexPath("");
const appAsarSha256 = createHash("sha256").update(await readFile(appAsarPath)).digest("hex");
const reports = [];
let background;

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function executable(file, source) {
  await writeFile(file, `#!/bin/sh\n${source}\n`, { mode: 0o700 });
  await chmod(file, 0o700);
  return file;
}

function exactFakeBody(metadata) {
  return `
if [ "$1" = "--version" ]; then echo 'codex-cli 1.0.0'; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo 'Logged in using synthetic test fixture'; exit 0; fi
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; output="$1"; fi
  shift
done
${metadata}
printf '%s' '{"question_text":"Synthetic QA question","option_label":"","option_number":"","answer_text":"Synthetic answer","confidence":1}' > "$output"
`;
}

async function runProbe(name, configure) {
  const probeDirectory = path.join(directory, name);
  const userData = path.join(probeDirectory, "user-data");
  const proof = path.join(probeDirectory, "proof.jsonl");
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "settings.json"), JSON.stringify({ codexPath: "", timeoutSeconds: 30, captureMode: "display", model: "gpt-5.6-luna", reasoningEffort: "medium", autoIntervalSeconds: 5, overlayOpacity: 1, interactionMode: "manual", manualShortcut: "CommandOrControl+Alt+Shift+6", resultLayout: "answer-only" }));
  const setup = await configure(probeDirectory);
  const environment = { ...process.env, CODEX_PATH: setup.codexPath ?? realCodex, CHEATYKITTY_HOTKEY_PROOF_FILE: proof, CHEATYKITTY_HOTKEY_PROOF_TRIGGER: "1", ...setup.env };
  const application = spawn(appExecutable, [`--user-data-dir=${userData}`], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  application.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 4096); });
  try {
    await setup.afterSpawn?.();
    const events = await waitFor(async () => {
      const rows = (await readFile(proof, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
      return rows.some((event) => event.event === "run-complete") ? rows : null;
    }, setup.timeoutMs ?? 12_000, `${name} completion`);
    const completion = events.findLast((event) => event.event === "run-complete");
    if (completion?.outcome !== "error") throw new Error(`${name} did not fail closed: ${JSON.stringify({ events, stderr })}`);
    await setup.assert(events);
    reports.push({ scenario: name, outcome: "rejected", appAsarSha256 });
  } finally {
    if (application.exitCode === null) application.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => application.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 750))]);
  }
}

try {
  const backgroundReady = path.join(directory, "background-ready.json");
  background = spawn(electron, [path.join(root, "scripts/capture-proof-background.cjs")], { env: { ...process.env, CHEATYKITTY_PROOF_BACKGROUND_READY: backgroundReady }, stdio: ["ignore", "pipe", "pipe"] });
  await waitFor(() => readFile(backgroundReady), 10_000, "controlled synthetic background");

  await runProbe("wrong-executable", async (probeDirectory) => {
    const invocationLog = path.join(probeDirectory, "invocations.txt");
    const codexPath = await executable(path.join(probeDirectory, "codex"), `printf '%s\\n' "$*" >> '${invocationLog}'\necho 'unrelated utility 1.0'`);
    return { codexPath, assert: async (events) => {
      if (events.some((event) => event.event === "run-phase" || event.event === "codex-invocation")) throw new Error("wrong executable reached capture or production invocation");
      const log = await readFile(invocationLog, "utf8");
      if (/--image|--output-schema|Synthetic QA/i.test(log)) throw new Error("wrong executable received sensitive arguments");
    } };
  });

  await runProbe("executable-swap", async (probeDirectory) => {
    const ready = path.join(probeDirectory, "login-ready");
    const proceed = path.join(probeDirectory, "login-proceed");
    const codexPath = await executable(path.join(probeDirectory, "codex"), `if [ "$1" = "--version" ]; then echo 'codex-cli 1.0.0'; exit 0; fi\nif [ "$1" = "login" ]; then touch '${ready}'; while [ ! -f '${proceed}' ]; do sleep 0.02; done; exit 0; fi\nexit 99`);
    const replacement = await executable(path.join(probeDirectory, "replacement"), exactFakeBody("echo 'model: gpt-5.6-luna' >&2\necho 'reasoning effort: medium' >&2"));
    return { codexPath, afterSpawn: async () => {
      await waitFor(() => readFile(ready), 5_000, "preflight login checkpoint");
      await rename(replacement, codexPath);
      await writeFile(proceed, "continue");
    }, assert: (events) => {
      if (events.some((event) => event.event === "run-phase" || event.event === "codex-invocation")) throw new Error("swapped executable reached capture or production invocation");
    } };
  });

  for (const [name, metadata] of [
    ["model-mismatch", "echo 'model: gpt-5.6-sol' >&2\necho 'reasoning effort: medium' >&2"],
    ["missing-model-metadata", ":"],
    ["contradictory-metadata", "echo 'model: gpt-5.6-luna' >&2\necho 'reasoning effort: medium' >&2\necho 'model: gpt-5.6-sol' >&2\necho 'reasoning effort: high' >&2"]
  ]) {
    await runProbe(name, async (probeDirectory) => ({
      codexPath: await executable(path.join(probeDirectory, "codex"), exactFakeBody(metadata)),
      timeoutMs: 30_000,
      assert: (events) => {
        if (!events.some((event) => event.event === "codex-invocation")) throw new Error(`${name} never reached production metadata gate`);
        if (events.some((event) => event.event === "run-complete" && event.outcome === "answer")) throw new Error(`${name} answer was accepted`);
      }
    }));
  }

  for (const [name, body] of [
    ["sck-hang", "trap '' TERM\nwhile :; do sleep 1; done"],
    ["sck-stderr-flood", "while :; do printf '0123456789abcdef' >&2; done"]
  ]) {
    await runProbe(name, async (probeDirectory) => ({
      env: { CHEATYKITTY_SCK_PROOF_HELPER: await executable(path.join(probeDirectory, "sck-helper"), body), CHEATYKITTY_SCK_PROOF_TIMEOUT_MS: "200" },
      assert: (events) => {
        if (!events.some((event) => event.event === "run-phase" && event.phase === "capturing")) throw new Error(`${name} did not enter capture`);
        if (events.some((event) => event.event === "codex-invocation")) throw new Error(`${name} reached Codex invocation`);
      }
    }));
  }

  const expectedScenarios = ["wrong-executable", "executable-swap", "model-mismatch", "missing-model-metadata", "contradictory-metadata", "sck-hang", "sck-stderr-flood"];
  if (JSON.stringify(reports.map((report) => report.scenario)) !== JSON.stringify(expectedScenarios) || new Set(reports.map((report) => report.appAsarSha256)).size !== 1) throw new Error("Incomplete exact-ASAR negative probe matrix");
  const output = path.join(root, "artifacts/packaged-negative-probes.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, appAsarSha256, scenarios: reports }, null, 2)}\n`);
  console.log(`Packaged negative probes passed: ${reports.map((report) => report.scenario).join(", ")}; app.asar ${appAsarSha256}`);
} finally {
  if (background && background.exitCode === null) background.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
