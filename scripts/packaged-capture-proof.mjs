import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const proofDirectory = path.resolve("artifacts/capture-proof");
const appExecutable = path.resolve("release/mac-arm64/CheatyKitty.app/Contents/MacOS/CheatyKitty");
const helper = path.resolve("release/mac-arm64/CheatyKitty.app/Contents/Resources/app.asar.unpacked/dist/native/sck-capture");
const run = (file, args) => promisify(execFile)(file, args, { encoding: "buffer", maxBuffer: 200 * 1024 * 1024 });
await rm(proofDirectory, { recursive: true, force: true });
await mkdir(proofDirectory, { recursive: true });
const electron = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const backgroundReady = path.join(proofDirectory, "background-ready.json");
const background = spawn(electron, ["scripts/capture-proof-background.cjs"], { env: { ...process.env, CHEATYKITTY_PROOF_BACKGROUND_READY: backgroundReady }, stdio: ["ignore", "pipe", "pipe"] });
const backgroundDeadline = Date.now() + 10_000;
while (Date.now() < backgroundDeadline) { try { await readFile(backgroundReady); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
try { await readFile(backgroundReady); } catch { background.kill("SIGTERM"); throw new Error("Controlled capture-proof background did not become ready."); }
const baseline = await run(helper, ["0", "0"]);
await writeFile(path.join(proofDirectory, "hidden-baseline.png"), baseline.stdout);
const child = spawn(appExecutable, [], { env: { ...process.env, CHEATYKITTY_CAPTURE_PROOF_DIR: proofDirectory }, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
try {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { await readFile(path.join(proofDirectory, "raw-control-ready.txt")); break; }
    catch {
      try { throw new Error(await readFile(path.join(proofDirectory, "packaged-filtered.error.txt"), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  try { await readFile(path.join(proofDirectory, "packaged-filtered.png")); }
  catch { throw new Error(`Packaged capture did not finish. ${stderr}`); }
  const rawVisible = await run(helper, ["0", "0"]);
  await writeFile(path.join(proofDirectory, "raw-visible.png"), rawVisible.stdout);
} finally {
  child.kill("SIGTERM");
  background.kill("SIGTERM");
}
const comparison = await run(electron, ["scripts/compare-capture-proof.cjs", proofDirectory]);
process.stdout.write(comparison.stdout);
