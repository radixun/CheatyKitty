import { spawn } from "node:child_process";
import path from "node:path";

const packaged = process.argv.includes("--packaged");
const executable = packaged
  ? path.resolve("release/mac-arm64/CheatyKitty.app/Contents/MacOS/CheatyKitty")
  : (await import("electron")).default;
const child = spawn(executable, packaged ? [] : ["."], { env: { ...process.env, CHEATYKITTY_SMOKE: "1" }, stdio: "pipe" });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
child.on("error", (error) => {
  clearTimeout(timer);
  console.error(`Could not start ${packaged ? "packaged CheatyKitty" : "Electron"}: ${error.message}`);
  process.exitCode = 1;
});
child.on("close", (code) => {
  clearTimeout(timer);
  if (code === 0) console.log(`${packaged ? "Packaged" : "Source"} Electron smoke launch reached app ready and exited cleanly.`);
  else { console.error(stderr); process.exitCode = 1; }
});
