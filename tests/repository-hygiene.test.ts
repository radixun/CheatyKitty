import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("hygiene inventories source with either Git metadata layout and ignores scratch output", async () => {
  const { filesBelow } = await import("../scripts/repo-hygiene.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-hygiene-"));
  try {
    await mkdir(path.join(directory, "src"));
    await mkdir(path.join(directory, ".agent-work"));
    await mkdir(path.join(directory, "dist"));
    await writeFile(path.join(directory, "src/main.ts"), "export {};\n");
    await writeFile(path.join(directory, "README.md"), "# Synthetic project\n");
    await writeFile(path.join(directory, ".gitignore"), "/.agent-work/\n");
    await writeFile(path.join(directory, ".agent-work/review.jsonl"), "scratch\n");
    await writeFile(path.join(directory, "dist/main.js"), "build\n");
    await writeFile(path.join(directory, ".git"), "gitdir: /synthetic/project/.git/worktrees/check\n");
    const expected = [".gitignore", "README.md", "src/main.ts"];
    assert.deepEqual((await filesBelow(directory)).sort(), expected);
    await rm(path.join(directory, ".git"));
    await mkdir(path.join(directory, ".git"));
    await writeFile(path.join(directory, ".git/config"), "metadata\n");
    assert.deepEqual((await filesBelow(directory)).sort(), expected);
    await writeFile(path.join(directory, "settings.json"), "{}\n");
    assert.ok((await filesBelow(directory)).includes("settings.json"), "local settings outside ignored output must remain visible to the scanner");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository policy excludes sensitive evidence and signing directories", async () => {
  const ignore = await readFile(".gitignore", "utf8");
  for (const directory of ["screenshots", "captures", "recordings", "evidence", "proof", "signing", "fixtures/private"]) {
    assert.match(ignore, new RegExp(`/${directory.replace("/", "\\/")}/`));
  }
});

test("repository hygiene allows only the reviewed README media surface", async () => {
  const hygiene = await readFile("scripts/repo-hygiene.mjs", "utf8");
  for (const media of ["main-result.png", "settings.png", "synthetic-demo.gif"]) assert.match(hygiene, new RegExp(`docs/media/${media.replace(".", "\\.")}`));
  assert.match(hygiene, /unapproved image/);
});

test("repository hygiene detects structured raw QA/OCR evidence outside code fixtures", async () => {
  const hygiene = await readFile("scripts/repo-hygiene.mjs", "utf8");
  for (const token of ["question_text", "answer_text", "ocrText", "screenshot", "rawOutput"]) assert.match(hygiene, new RegExp(token));
  assert.match(hygiene, /possible raw OCR\/question\/answer\/capture evidence/);
  assert.match(hygiene, /does not prove/);
  assert.match(hygiene, /git history metadata/);
  assert.match(hygiene, /ls-tree/);
  assert.match(hygiene, /sourcePath === "package-lock\.json"/);
});
