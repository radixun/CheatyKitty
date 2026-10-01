import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { persistSettings } = require("../src/renderer/settings-actions.js") as {
  persistSettings: (api: { saveSettings: (settings: unknown) => Promise<unknown> }, settings: unknown) => Promise<{ ok: boolean; message: string }>;
};

test("settings save failure is handled and returned as an actionable diagnostic", async () => {
  const result = await persistSettings({ saveSettings: async () => { throw new Error("Disk is read-only"); } }, { overlayOpacity: .7 });
  assert.equal(result.ok, false);
  assert.match(result.message, /Could not save settings/);
  assert.match(result.message, /Disk is read-only/);
});

test("settings save success returns the atomically persisted settings", async () => {
  const saved = { overlayOpacity: .7 };
  const result = await persistSettings({ saveSettings: async () => saved }, saved);
  assert.deepEqual(result, { ok: true, message: "", settings: saved });
});
