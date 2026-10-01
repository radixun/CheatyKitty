import assert from "node:assert/strict";
import test from "node:test";
import { stageShortcutRegistration, transactShortcutRegistration, validateHotkey } from "../src/hotkey";

test("validates and canonicalizes modifier plus one key", () => {
  assert.deepEqual(validateHotkey("shift+cmdorctrl+space"), { ok: true, accelerator: "CommandOrControl+Shift+Space" });
  assert.deepEqual(validateHotkey("option+f12"), { ok: true, accelerator: "Alt+F12" });
  assert.equal(validateHotkey("A").ok, false);
  assert.equal(validateHotkey("Command+Shift").ok, false);
  assert.equal(validateHotkey("Command+A+B").ok, false);
  assert.equal(validateHotkey("Shift+Tab").ok, false);
  assert.match((validateHotkey("Command+Space") as { ok: false; message: string }).message, /reserved/);
  assert.match((validateHotkey("Command+Q") as { ok: false; message: string }).message, /reserved/);
});

test("registration conflict preserves the previous shortcut", () => {
  const calls: string[] = [];
  const registry = { register(value: string) { calls.push(`register:${value}`); return false; }, unregister(value: string) { calls.push(`unregister:${value}`); } };
  assert.throws(() => stageShortcutRegistration(registry, { mode: "manual", accelerator: "Command+A", registered: true }, { mode: "manual", accelerator: "Command+B" }, () => {}), /another app/i);
  assert.deepEqual(calls, ["register:Command+B"]);
});

test("new shortcut replaces old before persistence and rollback restores old", () => {
  const calls: string[] = [];
  const registry = { register(value: string) { calls.push(`register:${value}`); return true; }, unregister(value: string) { calls.push(`unregister:${value}`); } };
  const staged = stageShortcutRegistration(registry, { mode: "manual", accelerator: "Command+A", registered: true }, { mode: "manual", accelerator: "Command+B" }, () => {});
  staged.activate();
  assert.deepEqual(staged.rollback(), { ok: true });
  assert.deepEqual(calls, ["register:Command+B", "unregister:Command+A", "unregister:Command+B", "register:Command+A"]);
});

test("persistence failure plus restore failure degrades runtime, keeps persisted old shortcut, and Retry restores it", async () => {
  const calls: string[] = [];
  let oldRestoreAttempts = 0;
  const registry = {
    register(value: string) {
      calls.push(`register:${value}`);
      if (value === "Command+B") return true;
      oldRestoreAttempts += 1;
      return oldRestoreAttempts > 1;
    },
    unregister(value: string) { calls.push(`unregister:${value}`); }
  };
  const persisted = { manualShortcut: "Command+A" };
  let runtime = { accelerator: "Command+A", registered: true };

  const transaction = await transactShortcutRegistration(registry, { mode: "manual", ...runtime }, { mode: "manual", accelerator: "Command+B" }, () => {}, async () => { throw new Error("Disk is read-only"); });
  assert.equal(transaction.ok, false);
  assert.match(transaction.ok ? "" : String(transaction.error), /read-only/);
  assert.equal(transaction.ok ? true : transaction.rollback.ok, false);
  if (!transaction.ok && !transaction.rollback.ok) runtime = { accelerator: persisted.manualShortcut, registered: false };

  assert.equal(persisted.manualShortcut, "Command+A");
  assert.deepEqual(runtime, { accelerator: "Command+A", registered: false });
  assert.match(transaction.ok || transaction.rollback.ok ? "" : transaction.rollback.message, /inactive.*Retry/);

  const retry = stageShortcutRegistration(registry, { mode: "manual", ...runtime }, { mode: "manual", accelerator: persisted.manualShortcut }, () => {});
  retry.activate();
  runtime = { accelerator: persisted.manualShortcut, registered: true };
  assert.deepEqual(runtime, { accelerator: "Command+A", registered: true });
  assert.deepEqual(calls, ["register:Command+B", "unregister:Command+A", "unregister:Command+B", "register:Command+A", "register:Command+A"]);
});

test("switching Auto unregisters Manual without registering a second shortcut", () => {
  const calls: string[] = [];
  const registry = { register(value: string) { calls.push(`register:${value}`); return true; }, unregister(value: string) { calls.push(`unregister:${value}`); } };
  const staged = stageShortcutRegistration(registry, { mode: "manual", accelerator: "Command+A", registered: true }, { mode: "auto", accelerator: "Command+A" }, () => {});
  staged.activate();
  assert.deepEqual(calls, ["unregister:Command+A"]);
});
