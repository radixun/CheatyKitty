import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCaptureHelper } from "../src/capture-process";

async function helper(directory: string, body: string): Promise<string> {
  const executable = path.join(directory, `capture-${Math.random().toString(16).slice(2)}`);
  await writeFile(executable, `#!/bin/sh\n${body}\n`);
  await chmod(executable, 0o700);
  return executable;
}

test("capture helper timeout terminates a hung process and clears its process reference", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-capture-hang-"));
  try {
    const executable = await helper(directory, "trap '' TERM\nwhile :; do sleep 1; done");
    const references: unknown[] = [];
    const started = Date.now();
    await assert.rejects(runCaptureHelper(executable, [], { timeoutMs: 80, terminateGraceMs: 80, onProcess: (child) => references.push(child) }), /timed out/);
    assert.ok(Date.now() - started < 2_000);
    assert.ok(references[0]);
    assert.equal(references.at(-1), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("capture helper stops and discards an unbounded stderr flood", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-capture-flood-"));
  try {
    const executable = await helper(directory, "while :; do printf '0123456789abcdef' >&2; done");
    await assert.rejects(runCaptureHelper(executable, [], { timeoutMs: 2_000, terminateGraceMs: 80, maxStderrBytes: 1024 }), /1 KiB diagnostic limit/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("capture helper late close settles once and cancels forced-kill timer", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-capture-late-close-"));
  try {
    const executable = await helper(directory, "trap 'exit 0' TERM\nsleep 5");
    let cleared = 0;
    await assert.rejects(runCaptureHelper(executable, [], { timeoutMs: 80, terminateGraceMs: 500, onProcess: (child) => { if (child === null) cleared += 1; } }), /timed out/);
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(cleared, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("capture helper compacts and redacts bounded failure diagnostics", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-capture-redact-"));
  try {
    const executable = await helper(directory, "echo 'Authorization: Bearer synthetic-secret-value qa.user@example.test' >&2\nexit 7");
    await assert.rejects(runCaptureHelper(executable, [], { timeoutMs: 1_000 }), (error: Error) => {
      assert.doesNotMatch(error.message, /synthetic-secret-value|qa\.user/);
      assert.match(error.message, /REDACTED/);
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
