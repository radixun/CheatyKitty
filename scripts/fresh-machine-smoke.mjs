import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveCodex } = require("../dist/codex.js");
const { loadSettingsWithFallback, saveSettings } = require("../dist/settings.js");
const root = await mkdtemp(path.join(tmpdir(), "cheatykitty-fresh-machine-"));

async function fakeExecutable(file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "#!/bin/sh\necho 'codex-cli synthetic-fixture'\n", { mode: 0o700 });
  await chmod(file, 0o700);
  return file;
}

try {
  const home = path.join(root, "home");
  const applications = path.join(root, "Applications");
  const pathBin = path.join(root, "path-bin");
  const emptyApplications = path.join(root, "NoApplications");
  const pathCodex = await fakeExecutable(path.join(pathBin, "codex"));
  const envCodex = await fakeExecutable(path.join(root, "env-bin", "codex"));
  const bundledCodex = await fakeExecutable(path.join(applications, "ChatGPT.app/Contents/Resources/codex"));

  const fromPath = await resolveCodex("", { PATH: pathBin }, home, emptyApplications);
  if (fromPath.path !== pathCodex || fromPath.source !== "PATH") throw new Error("isolated PATH discovery failed");
  const fromEnvironment = await resolveCodex("", { PATH: pathBin, CODEX_PATH: envCodex }, home, emptyApplications);
  if (fromEnvironment.path !== envCodex || fromEnvironment.source !== "CODEX_PATH") throw new Error("isolated CODEX_PATH discovery failed");
  const fromBundle = await resolveCodex("", { PATH: "" }, home, applications);
  if (fromBundle.path !== bundledCodex || !fromBundle.source.includes("ChatGPT.app")) throw new Error("isolated ChatGPT bundle discovery failed");
  await resolveCodex(path.join(root, "missing-saved-codex"), { PATH: pathBin }, home, applications)
    .then(() => { throw new Error("missing saved override silently fell back"); }, (error) => {
      if (!/clear the override/i.test(String(error))) throw error;
    });

  const primary = path.join(root, "new-user-data");
  const legacy = path.join(root, "legacy-user-data");
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, "settings.json"), JSON.stringify({ codexPath: "/old-machine/codex", model: "gpt-5.6-sol", overlayOpacity: 0.75 }));
  const migrated = await loadSettingsWithFallback(primary, legacy);
  if (!migrated.migrated || migrated.settings.codexPath !== "" || migrated.settings.model !== "gpt-5.6-sol") throw new Error("portable settings migration failed");
  await saveSettings(primary, migrated.settings);
  if (JSON.parse(await readFile(path.join(primary, "settings.json"), "utf8")).codexPath !== "") throw new Error("old-machine executable was persisted");

  console.log("Fresh-machine simulation passed: isolated HOME/PATH/userData, saved override, CODEX_PATH, PATH, ChatGPT bundle, and legacy migration.");
} finally {
  await rm(root, { recursive: true, force: true });
}
