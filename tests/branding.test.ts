import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical CheatyKitty icon is stable and owns macOS/DMG packaging", async () => {
  const icon = await readFile("assets/cheatykitty-icon.png");
  assert.equal(createHash("sha256").update(icon).digest("hex"), "34bbb143a92657ca79063d76003d07201cf9fc4310855f384cc517ca8354f219");
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.name, "cheatykitty");
  assert.equal(packageJson.build.productName, "CheatyKitty");
  assert.equal(packageJson.build.appId, "com.cheatykitty.app");
  assert.equal(packageJson.build.mac.icon, "build/CheatyKitty.icns");
  assert.equal(packageJson.build.dmg.icon, "build/CheatyKitty.icns");
  assert.match(packageJson.scripts.build, /verify-icon\.mjs/);
  assert.match(packageJson.scripts.build, /prepare-icon\.mjs/);
  assert.match(packageJson.scripts["prepare:electron-runtime"], /prepare-electron-runtime\.mjs/);
  assert.match(packageJson.scripts["dist:mac"], /^npm run prepare:electron-runtime &&/);
  assert.deepEqual(packageJson.build.extraResources.map((entry: { to: string }) => entry.to), ["LICENSE.electron.txt", "LICENSES.chromium.html"]);
});

test("user-facing metadata is CheatyKitty", async () => {
  const [mainHtml, settingsHtml, notices] = await Promise.all([
    readFile("src/renderer/index.html", "utf8"),
    readFile("src/renderer/settings.html", "utf8"),
    readFile("THIRD_PARTY_NOTICES.md", "utf8")
  ]);
  assert.match(mainHtml, /<title>CheatyKitty<\/title>/);
  assert.match(settingsHtml, /<title>CheatyKitty Settings<\/title>/);
  assert.match(notices, /Electron/);
  const main = await readFile("src/main.ts", "utf8");
  assert.equal((main.match(/"PeekaTest"/g) || []).length, 1, "former product userData fallback must be the only source compatibility occurrence");
});
