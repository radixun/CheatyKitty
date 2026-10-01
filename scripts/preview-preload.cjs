const { contextBridge } = require("electron");

const preview = process.argv.find((value) => value.startsWith("--cheatykitty-preview="))?.split("=")[1] || "ready";
const states = {
  ready: { kind: "ready", detail: "Press ⌘⇧Space to capture.", model: "Default — 5.6 Luna · Medium", mode: "manual", shortcut: "⌘⇧Space", autoActive: false, autoIntervalSeconds: 5, resultLayout: "question-answer" },
  "demo-capturing": { kind: "capturing", model: "Default — 5.6 Luna · Medium", mode: "auto", shortcut: "⌘⇧Space", autoActive: true, autoIntervalSeconds: 5, resultLayout: "question-answer" },
  "demo-thinking": { kind: "thinking", model: "Default — 5.6 Luna · Medium", mode: "auto", shortcut: "⌘⇧Space", autoActive: true, autoIntervalSeconds: 5, resultLayout: "question-answer" },
  "demo-result": { kind: "answer", model: "Default — 5.6 Luna · Medium", mode: "auto", shortcut: "⌘⇧Space", autoActive: true, autoIntervalSeconds: 5, resultLayout: "question-answer", answer: { questionText: "What is 2 + 2?  A. 3  ·  B. 4  ·  C. 5", label: "B", text: "4", confidence: 1 } },
  busy: { kind: "thinking", model: "Default — 5.6 Luna · Medium", mode: "auto", shortcut: "⌘⇧Space", autoActive: true, autoIntervalSeconds: 7, resultLayout: "question-answer", retainedAnswer: { questionText: "Which protocol resolves host names?", label: "B", text: "DNS", confidence: .96 } },
  result: { kind: "answer", model: "5.6 Sol · Medium", mode: "manual", shortcut: "⌘⇧Space", autoActive: false, autoIntervalSeconds: 5, resultLayout: "question-answer", answer: { questionText: "What is 2 + 2?", label: "B", text: "4", confidence: 1 } },
  "answer-only": { kind: "answer", model: "5.3 Codex Spark · Medium", mode: "manual", shortcut: "⌘⇧Space", autoActive: false, autoIntervalSeconds: 5, resultLayout: "answer-only", answer: { questionText: "Which protocol resolves host names?", label: "B", text: "DNS translates human-readable host names into IP addresses while this full-width answer safely wraps within the current display work area.", confidence: .96 } },
  "answer-only-busy": { kind: "capturing", model: "Default — 5.6 Luna · Medium", mode: "manual", shortcut: "⌘⇧9", autoActive: false, autoIntervalSeconds: 5, resultLayout: "answer-only", retainedAnswer: { questionText: "Which protocol resolves host names?", label: "B", text: "DNS translates human-readable host names into IP addresses while this full-width answer remains visible under progress.", confidence: .96 } },
  "answer-only-thinking": { kind: "thinking", model: "5.3 Codex Spark · Medium", mode: "manual", shortcut: "⌘⇧9", autoActive: false, autoIntervalSeconds: 5, resultLayout: "answer-only", retainedAnswer: { questionText: "Which protocol resolves host names?", label: "B", text: "DNS translates human-readable host names into IP addresses while this full-width answer remains visible under progress.", confidence: .96 } },
  "answer-only-error": { kind: "error", message: "Spark needs readable local OCR. Try a larger capture area or clearer text.", model: "5.3 Codex Spark · Medium", mode: "manual", shortcut: "⌘⇧9", autoActive: false, autoIntervalSeconds: 5, resultLayout: "answer-only" }
};

contextBridge.exposeInMainWorld("cheatykitty", {
  getSettings: async () => ({ codexPath: "", timeoutSeconds: 90, captureMode: "display", model: "gpt-5.6-luna", reasoningEffort: "medium", fastMode: false, autoIntervalSeconds: 7, overlayOpacity: .82, interactionMode: "auto", manualShortcut: "CommandOrControl+Shift+Space", resultLayout: "question-answer" }),
  onOpacity: (callback) => callback(1),
  listModels: async () => [{ model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", reasoningEfforts: [{ effort: "medium", description: "Balanced" }, { effort: "high", description: "Deeper reasoning" }], inputModalities: ["text", "image"], serviceTiers: [{ id: "priority", name: "Fast", description: "1.5x speed, increased usage" }] }],
  saveSettings: async (settings) => settings,
  previewOpacity: async () => {}, openSettings: () => {}, closeSettings: () => {}, quit: () => {}, setHitRegions: () => {}, clearHitRegions: () => {},
  validateShortcut: async (shortcut) => ({ ok: true, accelerator: shortcut }),
  startShortcutRecording: async () => ({ ok: true, message: "Listening." }),
  checkShortcutCandidate: async (shortcut) => ({ ok: true, accelerator: shortcut }),
  stopShortcutRecording: async () => ({ ok: true, message: "Shortcut restored." }),
  retryShortcut: async () => ({ ok: true, message: "⌘⇧Space is active." }),
  chooseCodex: async () => null,
  inspectCodex: async () => ({ resolvedPath: "Auto-detected Codex CLI", source: "Local discovery", status: "ready", version: "Version verified", authStatus: "authenticated", modelStatus: "Not tested", connectionStatus: "Executable ready", message: "Local Codex CLI is ready." }),
  testCodex: async () => ({ connectionStatus: "connected", modelStatus: "Default — 5.6 Luna · Medium", message: "Default — 5.6 Luna · Medium validated successfully." }),
  resizeMain: async () => {}, cancel: () => {},
  onState: (callback) => callback(states[preview] || states.ready)
});
