import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettingsWithFallback, sanitizeSettings, saveSettings } from "../src/settings";

test("migrates settings without model and interval to Luna medium and five seconds", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-settings-"));
  try {
    await writeFile(path.join(directory, "settings.json"), JSON.stringify({ codexPath: " /bin/codex ", timeoutSeconds: 45, captureMode: "area" }));
    const loaded = await loadSettingsWithFallback(directory, path.join(directory, "former-product"));
    assert.equal(loaded.migrated, false);
    assert.deepEqual(loaded.settings, { codexPath: "/bin/codex", timeoutSeconds: 45, captureMode: "area", model: "gpt-5.6-luna", reasoningEffort: "medium", fastMode: false, autoIntervalSeconds: 5, overlayOpacity: 1, interactionMode: "manual", manualShortcut: "CommandOrControl+Shift+Space", resultLayout: "question-answer" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("sanitizes and persists a selected model", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-settings-"));
  try {
    const saved = await saveSettings(directory, { codexPath: "  /bin/codex ", timeoutSeconds: 999, captureMode: "display", model: "gpt-5.6-sol", reasoningEffort: "medium", fastMode: false, autoIntervalSeconds: 11, overlayOpacity: .63, interactionMode: "manual", manualShortcut: "CommandOrControl+Shift+Space", resultLayout: "answer-only" });
    assert.deepEqual(saved, { codexPath: "/bin/codex", timeoutSeconds: 300, captureMode: "display", model: "gpt-5.6-sol", reasoningEffort: "medium", fastMode: false, autoIntervalSeconds: 11, overlayOpacity: .63, interactionMode: "manual", manualShortcut: "CommandOrControl+Shift+Space", resultLayout: "answer-only" });
    assert.equal(JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8")).model, "gpt-5.6-sol");
    assert.equal((await loadSettingsWithFallback(directory, path.join(directory, "former-product"))).settings.overlayOpacity, .63);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("sanitizeSettings defaults missing or invalid fields", () => {
  assert.deepEqual(sanitizeSettings({}), { codexPath: "", timeoutSeconds: 90, captureMode: "display", model: "gpt-5.6-luna", reasoningEffort: "medium", fastMode: false, autoIntervalSeconds: 5, overlayOpacity: 1, interactionMode: "manual", manualShortcut: "CommandOrControl+Shift+Space", resultLayout: "question-answer" });
});

test("sanitizes opacity and migrates legacy executable property", () => {
  assert.equal(sanitizeSettings({ overlayOpacity: .1 }).overlayOpacity, .25);
  assert.equal(sanitizeSettings({ overlayOpacity: 4 }).overlayOpacity, 1);
  assert.equal(sanitizeSettings({ overlayOpacity: "0.734" } as never).overlayOpacity, .73);
  assert.equal(sanitizeSettings({ codexExecutable: " /legacy/codex " } as never).codexPath, "/legacy/codex");
});

test("Auto capture is mutually exclusive with area selection", () => {
  const settings = sanitizeSettings({ interactionMode: "auto", captureMode: "area" });
  assert.equal(settings.interactionMode, "auto");
  assert.equal(settings.captureMode, "display");
});

test("preserves arbitrary models and clamps Auto interval to 3..15", () => {
  assert.equal(sanitizeSettings({ model: "" }).model, "gpt-5.6-luna");
  assert.equal(sanitizeSettings({ model: "gpt-5.4" }).model, "gpt-5.4");
  assert.equal(sanitizeSettings({ model: "gpt-5.3-codex-spark" }).model, "gpt-5.3-codex-spark");
  assert.equal(sanitizeSettings({ autoIntervalSeconds: 1 }).autoIntervalSeconds, 3);
  assert.equal(sanitizeSettings({ autoIntervalSeconds: 99 }).autoIntervalSeconds, 15);
  assert.equal(sanitizeSettings({ autoIntervalSeconds: 8.6 }).autoIntervalSeconds, 9);
});

test("falls back to legacy product userData once, but clears the old-machine executable", async () => {
  const primary = await mkdtemp(path.join(tmpdir(), "cheatykitty-primary-"));
  const legacy = await mkdtemp(path.join(tmpdir(), "cheatykitty-legacy-"));
  try {
    await writeFile(path.join(legacy, "settings.json"), JSON.stringify({ codexPath: "/old-machine/bin/codex", model: "gpt-5.6-sol", autoIntervalSeconds: 12 }));
    const loaded = await loadSettingsWithFallback(primary, legacy);
    assert.equal(loaded.migrated, true);
    assert.equal(loaded.settings.model, "gpt-5.6-sol");
    assert.equal(loaded.settings.autoIntervalSeconds, 12);
    assert.equal(loaded.settings.codexPath, "");
    await readFile(path.join(legacy, "settings.json"), "utf8");
  } finally { await Promise.all([rm(primary, { recursive: true, force: true }), rm(legacy, { recursive: true, force: true })]); }
});

test("a malformed primary settings file does not import stale legacy state", async () => {
  const primary = await mkdtemp(path.join(tmpdir(), "cheatykitty-primary-corrupt-"));
  const legacy = await mkdtemp(path.join(tmpdir(), "cheatykitty-legacy-stale-"));
  try {
    await writeFile(path.join(primary, "settings.json"), "{not-json");
    await writeFile(path.join(legacy, "settings.json"), JSON.stringify({ model: "gpt-5.6-sol" }));
    const loaded = await loadSettingsWithFallback(primary, legacy);
    assert.equal(loaded.migrated, false);
    assert.equal(loaded.settings.model, "gpt-5.6-luna");
  } finally { await Promise.all([rm(primary, { recursive: true, force: true }), rm(legacy, { recursive: true, force: true })]); }
});

test("new model IDs, reasoning levels and FAST survive a save/load round trip", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-model-settings-"));
  try {
    const requested = sanitizeSettings({ model: " future-model-v9 ", reasoningEffort: " ULTRA ", fastMode: true });
    const saved = await saveSettings(directory, requested);
    const loaded = await loadSettingsWithFallback(directory, path.join(directory, "legacy"));
    assert.equal(loaded.settings.model, "future-model-v9");
    assert.equal(loaded.settings.reasoningEffort, "ultra");
    assert.equal(loaded.settings.fastMode, true);
    assert.deepEqual(loaded.settings, saved);
    assert.equal(sanitizeSettings({ fastMode: "true" } as never).fastMode, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
