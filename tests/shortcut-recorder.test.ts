import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const policy = require("../src/renderer/shortcut-recorder-policy.js");

test("recorder ignores activation/repeat/modifier-only and canonicalizes RU/US physical key codes", () => {
  assert.equal(policy.shouldConsumeKey("recording", false, 100, 200), false);
  assert.equal(policy.shouldConsumeKey("recording", true, 300, 200), false);
  assert.equal(policy.acceleratorFromEvent({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, code: "MetaLeft" }), "");
  assert.equal(policy.acceleratorFromEvent({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, code: "KeyF", key: "А" }), "Command+Shift+F");
});

test("real renderer installs capture-phase suppression and explicit main recording session", async () => {
  const source = await readFile(new URL("../src/renderer/settings-renderer.js", import.meta.url), "utf8");
  assert.match(source, /startShortcutRecording\(\)/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /window\.addEventListener\("keydown",[\s\S]+}, true\);/);
  assert.match(source, /window\.addEventListener\("blur"/);
  assert.match(source, /finally \{[\s\S]*stopShortcutRecording\("candidate-checked"\)/);
  assert.match(source, /catch \(error\) \{[\s\S]*stopShortcutRecording\("recording-start-failed"\)/);
  assert.match(source, /beforeunload[\s\S]*stopShortcutRecording\("renderer-unload"\)\.catch/);
});

test("main owns exception-safe shortcut restoration for validation and settings failure paths", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const check = source.slice(source.indexOf('ipcMain.handle("shortcut:recording-check"'), source.indexOf('ipcMain.handle("shortcut:recording-stop"'));
  assert.match(check, /finally \{/);
  assert.match(check, /restoreShortcutAfterRecording\(\)/);
  assert.match(source, /render-process-gone", restoreShortcutAfterRecording/);
  assert.match(source, /window\.on\("closed", \(\) => \{\s*restoreShortcutAfterRecording\(\)/);
  assert.match(source, /CHEATYKITTY_HOTKEY_PROOF_TRIGGER[\s\S]*shortcutRegistered[\s\S]*shortcutAction\(\)/);
  assert.match(source, /transactShortcutRegistration[\s\S]*if \(!transaction\.rollback\.ok\)[\s\S]*shortcutRegistered = false/);
  assert.doesNotMatch(await readFile(new URL("../src/renderer/settings-renderer.js", import.meta.url), "utf8"), /previous shortcut remains saved and active/i);
  assert.match(await readFile(new URL("../src/renderer/settings-renderer.js", import.meta.url), "utf8"), /degraded = \/inactive; use Retry/);
  const suspend = source.slice(source.indexOf("function suspendShortcutForRecording"), source.indexOf("function restoreShortcutAfterRecording"));
  assert.match(suspend, /try \{/);
  assert.match(suspend, /catch \(error\)/);
  assert.match(suspend, /globalShortcut\.register\(accelerator, shortcutAction\)/);
});
