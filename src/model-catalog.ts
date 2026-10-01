import { spawn } from "node:child_process";
import { assertExecutableIdentity, compactProcessDiagnostic, type VerifiedCodexExecutable } from "./codex";

export interface CatalogModel {
  model: string;
  displayName: string;
  reasoningEfforts: { effort: string; description: string }[];
  inputModalities: string[];
  serviceTiers: { id: string; name: string; description: string }[];
}

export function parseCatalogModels(value: unknown): CatalogModel[] {
  if (!Array.isArray(value)) throw new Error("Codex returned an invalid model catalog.");
  return value.flatMap((entry) => {
    if (!entry || typeof entry.model !== "string" || !entry.model.trim()) return [];
    return [{
      model: entry.model,
      displayName: typeof entry.displayName === "string" ? entry.displayName : entry.model,
      reasoningEfforts: Array.isArray(entry.supportedReasoningEfforts) ? entry.supportedReasoningEfforts.flatMap((item: { reasoningEffort?: unknown; description?: unknown }) =>
        typeof item?.reasoningEffort === "string" ? [{ effort: item.reasoningEffort, description: typeof item.description === "string" ? item.description : "" }] : []) : [],
      inputModalities: Array.isArray(entry.inputModalities) ? entry.inputModalities.filter((item: unknown) => typeof item === "string") : ["text", "image"],
      serviceTiers: Array.isArray(entry.serviceTiers) ? entry.serviceTiers.flatMap((item: { id?: unknown; name?: unknown; description?: unknown }) =>
        typeof item?.id === "string" ? [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id, description: typeof item.description === "string" ? item.description : "" }] : []) : []
    }];
  });
}

// Discovery starts no thread/turn and requests no inference. The process is bounded
// and closed after all pages; it never returns account data to the renderer.
export async function listCodexModels(executable: VerifiedCodexExecutable): Promise<CatalogModel[]> {
  await assertExecutableIdentity(executable);
  return new Promise((resolve, reject) => {
    const child = spawn(executable.path, ["app-server", "--stdio", "-c", 'model_provider="openai"'], { shell: false, windowsHide: true });
    let buffer = "", stderr = "", bytes = 0, page = 0;
    let settled = false;
    const models: CatalogModel[] = [];
    const cursors = new Set<string>();
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
      killTimer.unref();
      if (error) reject(error); else resolve(models);
    };
    const timer = setTimeout(() => finish(new Error("Model discovery timed out. Enter a model ID manually or retry Refresh models.")), 15_000);
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const nextPage = (cursor?: string) => send({ id: ++page, method: "model/list", params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
    child.stdin.on("error", (error) => finish(error));
    child.on("error", (error) => finish(error));
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + String(chunk)).slice(-2000); });
    child.on("close", () => {
      if (killTimer) clearTimeout(killTimer);
      if (!settled) finish(new Error(`Model discovery stopped: ${compactProcessDiagnostic(stderr)}`));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { finish(new Error("Model catalog exceeded the size limit.")); return; }
      buffer += String(chunk);
      let newline: number;
      while (!settled && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.id !== page) continue;
          if (message.error) throw new Error(compactProcessDiagnostic(String(message.error.message)));
          if (page === 0) {
            send({ method: "initialized", params: {} }); nextPage();
          } else {
            models.push(...parseCatalogModels(message.result?.data));
            const cursor = message.result?.nextCursor;
            if (!cursor) finish();
            else if (typeof cursor !== "string" || cursors.has(cursor) || page >= 10) throw new Error("Invalid model catalog pagination.");
            else { cursors.add(cursor); nextPage(cursor); }
          }
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    send({ id: 0, method: "initialize", params: { clientInfo: { name: "cheatykitty", version: "1.0.0" } } });
  });
}
