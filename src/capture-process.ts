import { spawn, type ChildProcess } from "node:child_process";
import { compactProcessDiagnostic } from "./codex";

export interface CaptureProcessOptions {
  timeoutMs?: number;
  terminateGraceMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  isCancelled?: () => boolean;
  onProcess?: (child: ChildProcess | null) => void;
}

export function terminateCaptureHelper(child: ChildProcess, graceMs = 750): NodeJS.Timeout | undefined {
  try { child.kill("SIGTERM"); } catch { return undefined; }
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGKILL"); } catch { /* process already gone */ }
    }
  }, graceMs);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
  return timer;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_STDOUT_LIMIT = 160 * 1024 * 1024;
const DEFAULT_STDERR_LIMIT = 64 * 1024;

export function runCaptureHelper(executable: string, args: string[], options: CaptureProcessOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const graceMs = options.terminateGraceMs ?? 750;
    const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_STDOUT_LIMIT;
    const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_STDERR_LIMIT;
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    options.onProcess?.(child);
    let stdout: Buffer[] = [];
    let stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let failure: Error | null = null;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const requestStop = (error: Error) => {
      if (failure) return;
      failure = error;
      forceKillTimer = terminateCaptureHelper(child, graceMs);
    };

    const timeoutTimer = setTimeout(() => requestStop(new Error(`ScreenCaptureKit helper timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`)), timeoutMs);
    timeoutTimer.unref();

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.onProcess?.(null);
      callback();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || failure) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        stdout = [];
        requestStop(new Error(`ScreenCaptureKit helper exceeded the ${Math.round(maxStdoutBytes / 1024 / 1024)} MiB image limit.`));
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled || failure) return;
      stderrBytes += chunk.length;
      if (stderrBytes > maxStderrBytes) {
        stderr = [];
        requestStop(new Error(`ScreenCaptureKit helper exceeded the ${Math.round(maxStderrBytes / 1024)} KiB diagnostic limit.`));
      } else stderr.push(chunk);
    });
    child.once("error", (error) => finish(() => { stdout = []; stderr = []; reject(error); }));
    child.once("close", (code) => finish(() => {
      if (options.isCancelled?.()) return reject(new Error("Cancelled"));
      if (failure) { stdout = []; stderr = []; return reject(failure); }
      if (code !== 0) {
        const diagnostic = compactProcessDiagnostic(Buffer.concat(stderr).toString("utf8"), 320);
        stdout = []; stderr = [];
        return reject(new Error(`ScreenCaptureKit helper exited with ${code}: ${diagnostic}`));
      }
      const image = Buffer.concat(stdout);
      stdout = [];
      stderr = [];
      resolve(image);
    }));
  });
}
