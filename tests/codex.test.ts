import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertCodexExecutionMetadata, buildCodexArgs, buildCodexRequest, codexCandidateDetails, compactProcessDiagnostic, inspectCodex, preflightCodexPath, redactSensitiveDiagnostic, resolveCodex, resolveCodexPath, runCodex, testCodex, withTempWorkspace } from "../src/codex";
import type { QuestionContext } from "../src/question-options";

function fakeCodexScript(body: string, metadata = 'echo "model: $selected_model" >&2\necho "reasoning effort: medium" >&2') {
  return `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 1.0.0"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using synthetic test fixture"; exit 0; fi
selected_model=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--model" ]; then selected_model="$argument"; fi
  previous="$argument"
done
${metadata}
${body}`;
}

test("resolves an executable from CODEX_PATH before PATH", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cheatykitty-resolve-"));
  const executable = path.join(dir, "custom-codex");
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o700);
  assert.equal(await resolveCodexPath("", { CODEX_PATH: executable, PATH: "" }, dir), executable);
});

test("builds safe one-shot read-only arguments without a shell", () => {
  const args = buildCodexArgs({ imagePath: "/tmp/a.png", schemaPath: "/tmp/s.json", outputPath: "/tmp/o.json", workDir: "/tmp/work" });
  assert.deepEqual(args.slice(0, 8), ["exec", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never"]);
  assert.equal(args[args.indexOf("--image") + 1], "/tmp/a.png");
  assert.ok(!args.includes("danger-full-access"));
  assert.equal(args[args.indexOf("--model") + 1], "gpt-5.6-luna");
  assert.equal(args[args.indexOf("--config") + 1], 'model_reasoning_effort="medium"');
});

test("passes each supported model with exact medium reasoning argv", () => {
  for (const model of ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.3-codex-spark"] as const) {
    const args = buildCodexArgs({ imagePath: "/tmp/a.png", schemaPath: "/tmp/s.json", outputPath: "/tmp/o.json", workDir: "/tmp/work" }, model, "medium");
    assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 4), ["--model", model, "--config", 'model_reasoning_effort="medium"']);
  }
});

test("Spark uses exact selected model with OCR text and no image attachment", () => {
  const paths = { imagePath: "/tmp/private-capture.png", schemaPath: "/tmp/s.json", outputPath: "/tmp/o.json", workDir: "/tmp/work" };
  const context: QuestionContext = { lines: [{ text: "What is 2 + 2?", confidence: 1 }, { text: "B. 4", confidence: 1 }], questionText: "What is 2 + 2?", options: [{ label: "B", text: "4" }], ocrText: "What is 2 + 2?\nB. 4" };
  const request = buildCodexRequest(paths, context, "gpt-5.3-codex-spark", "medium");
  assert.equal(request.model, "gpt-5.3-codex-spark");
  assert.equal(request.reasoningEffort, "medium");
  assert.equal(request.imageAttached, false);
  assert.equal(request.args.includes("--image"), false);
  assert.equal(request.args.includes(paths.imagePath), false);
  assert.deepEqual(request.args.slice(request.args.indexOf("--model"), request.args.indexOf("--model") + 4), ["--model", "gpt-5.3-codex-spark", "--config", 'model_reasoning_effort="medium"']);
  assert.match(request.prompt, /Local macOS Vision OCR/);
  assert.match(request.prompt, /What is 2 \+ 2\?/);
  assert.match(request.prompt, /B\. 4/);
  assert.doesNotMatch(request.prompt, /private-capture\.png/);
  assert.match(request.prompt, /count them from top to bottom starting at 1/);
  assert.match(request.prompt, /option_label "" and option_number "3", never as option_label "C"/);
  assert.deepEqual(request.labeledOptionLabels, ["B"]);
  assert.equal(request.orderedOptionSha256s.length, 0);
});

test("Luna and Sol keep image input while receiving OCR context", () => {
  const paths = { imagePath: "/tmp/a.png", schemaPath: "/tmp/s.json", outputPath: "/tmp/o.json", workDir: "/tmp/work" };
  const context: QuestionContext = { lines: [{ text: "1. One", confidence: 1 }], questionText: "Q", options: [{ label: "1", text: "One" }], ocrText: "Q\n1. One" };
  for (const model of ["gpt-5.6-luna", "gpt-5.6-sol"] as const) {
    const request = buildCodexRequest(paths, context, model, "medium");
    assert.equal(request.imageAttached, true);
    assert.equal(request.args[request.args.indexOf("--image") + 1], paths.imagePath);
    assert.match(request.prompt, /Q\n1\. One/);
  }
});

test("vision model treats inferred OCR order as supplemental while Spark receives ordered OCR", () => {
  const context: QuestionContext = { lines: [], questionText: "Q", options: [], orderedOptions: [{ label: "1", text: "Missing first choice" }, { label: "2", text: "Correct choice" }, { label: "3", text: "Last choice" }], ocrText: "partial OCR", ocrAvailable: true };
  const paths = { imagePath: "/tmp/capture.png", schemaPath: "/tmp/schema.json", outputPath: "/tmp/output.json", workDir: "/tmp" };
  const luna = buildCodexRequest(paths, context, "gpt-5.6-luna", "medium");
  const spark = buildCodexRequest(paths, context, "gpt-5.3-codex-spark", "medium");
  assert.match(luna.prompt, /image is authoritative[\s\S]*may omit or reorder choices/);
  assert.doesNotMatch(luna.prompt, /Visual order 2: Correct choice/);
  assert.match(spark.prompt, /Visual order 2: Correct choice/);
});

test("Luna and Sol continue with the image when local OCR fails", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-vision-without-ocr-"));
  const ocr = path.join(directory, "ocr");
  const codex = path.join(directory, "codex");
  try {
    await writeFile(ocr, "#!/bin/sh\necho 'no readable text' >&2\nexit 7\n");
    await writeFile(codex, fakeCodexScript(`
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi
  shift
done
printf '%s' '{"question_text":"What is 2 + 2?","option_label":"B","option_number":"","answer_text":"4","confidence":1}' > "$out"
`));
    await Promise.all([chmod(ocr, 0o700), chmod(codex, 0o700)]);
    for (const model of ["gpt-5.6-luna", "gpt-5.6-sol"] as const) {
      const proofs: Parameters<NonNullable<Parameters<typeof runCodex>[5]["onInvocation"]>>[0][] = [];
      const verified = await preflightCodexPath(codex);
      const answer = await runCodex(Buffer.from("real screen pixels"), verified, 5, model, "medium", { ocrExecutable: ocr, onInvocation: (proof) => proofs.push(proof) });
      assert.equal(`${answer.label} — ${answer.text}`, "B — 4");
      assert.equal(proofs.length, 1);
      assert.equal(proofs[0].imageAttached, true);
      assert.equal(proofs[0].ocrAvailable, false);
      assert.match(proofs[0].prompt, /Use the attached image as the authoritative question/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Spark fails clearly before invocation when local OCR is unavailable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-spark-no-ocr-"));
  const ocr = path.join(directory, "ocr");
  const codex = path.join(directory, "codex");
  try {
    await writeFile(ocr, "#!/bin/sh\necho 'no readable text' >&2\nexit 7\n");
    await writeFile(codex, fakeCodexScript("echo invoked > codex-was-invoked\nexit 99"));
    await Promise.all([chmod(ocr, 0o700), chmod(codex, 0o700)]);
    const verified = await preflightCodexPath(codex);
    await assert.rejects(runCodex(Buffer.from("real screen pixels"), verified, 5, "gpt-5.3-codex-spark", "medium", { ocrExecutable: ocr }), /Spark needs readable local OCR.*cannot accept the screenshot.*no readable text/i);
    await assert.rejects(access(path.join(directory, "codex-was-invoked")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ambiguous first answer gets exactly one same-model text repair", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-repair-"));
  const ocr = path.join(directory, "ocr");
  const codex = path.join(directory, "codex");
  const state = path.join(directory, "state");
  try {
    await writeFile(ocr, `#!/bin/sh\nprintf '%s' '{"lines":[{"text":"Question?","confidence":1},{"text":"A. Same","confidence":1},{"text":"B. Same","confidence":1}]}'\n`);
    await writeFile(codex, fakeCodexScript(`out=''\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi\n  shift\ndone\nif [ -f "${state}" ]; then printf '%s' '{"question_text":"Question?","option_label":"B","option_number":"","answer_text":"Same","confidence":1}' > "$out"; else touch "${state}"; printf '%s' '{"question_text":"Question?","option_label":"","option_number":"","answer_text":"Same","confidence":0.5}' > "$out"; fi\n`));
    await Promise.all([chmod(ocr, 0o700), chmod(codex, 0o700)]);
    const proofs: Array<{ attempt: number; model: string; imageAttached: boolean; prompt: string }> = [];
    const answer = await runCodex(Buffer.from("png"), await preflightCodexPath(codex), 5, "gpt-5.3-codex-spark", "medium", { ocrExecutable: ocr, onInvocation: (proof) => proofs.push(proof) });
    assert.equal(`${answer.label} — ${answer.text}`, "B — Same");
    assert.deepEqual(proofs.map(({ attempt, model, imageAttached }) => ({ attempt, model, imageAttached })), [
      { attempt: 1, model: "gpt-5.3-codex-spark", imageAttached: false },
      { attempt: 2, model: "gpt-5.3-codex-spark", imageAttached: false }
    ]);
    assert.match(proofs[1].prompt, /Repair it once/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("former 'Codex could not identify one visible answer option after one repair attempt' case returns useful unlabeled text", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-unlabeled-fallback-"));
  const ocr = path.join(directory, "ocr");
  const codex = path.join(directory, "codex");
  try {
    await writeFile(ocr, `#!/bin/sh\nprintf '%s' '{"lines":[{"text":"Question text","confidence":1},{"text":"A. One","confidence":1},{"text":"B. Two","confidence":1}]}'\n`);
    await writeFile(codex, fakeCodexScript(`
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi
  shift
done
printf '%s' '{"question_text":"Question text","option_label":"","option_number":"","answer_text":"Useful paraphrased answer","confidence":0.7}' > "$out"
`));
    await Promise.all([chmod(ocr, 0o700), chmod(codex, 0o700)]);
    const attempts: number[] = [];
    const answer = await runCodex(Buffer.from("png"), await preflightCodexPath(codex), 5, "gpt-5.6-luna", "medium", { ocrExecutable: ocr, onInvocation: (proof) => attempts.push(proof.attempt) });
    assert.deepEqual(attempts, [1, 2]);
    assert.equal(answer.label, "");
    assert.equal(answer.text, "Useful paraphrased answer");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("explicit OCR conflict does not force a repair or veto a useful vision result", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-conflict-repair-"));
  const ocr = path.join(directory, "ocr");
  const codex = path.join(directory, "codex");
  const state = path.join(directory, "state");
  try {
    await writeFile(ocr, `#!/bin/sh\nprintf '%s' '{"lines":[{"text":"Question text","confidence":1},{"text":"A. One","confidence":1},{"text":"B. Two","confidence":1},{"text":"C. Three","confidence":1}]}'\n`);
    await writeFile(codex, fakeCodexScript(`
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi
  shift
done
if [ -f "${state}" ]; then
  printf '%s' '{"question_text":"Question text","option_label":"B","option_number":"","answer_text":"second choice","confidence":0.9}' > "$out"
else
  touch "${state}"
  printf '%s' '{"question_text":"Question text","option_label":"B","option_number":"","answer_text":"Three","confidence":0.6}' > "$out"
fi
`));
    await Promise.all([chmod(ocr, 0o700), chmod(codex, 0o700)]);
    const attempts: number[] = [];
    const answer = await runCodex(Buffer.from("png"), await preflightCodexPath(codex), 5, "gpt-5.6-sol", "medium", { ocrExecutable: ocr, onInvocation: (proof) => attempts.push(proof.attempt) });
    assert.deepEqual(attempts, [1]);
    assert.equal(`${answer.label} — ${answer.text}`, "B — Three");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("production exec accepts exact authoritative model and reasoning metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-exact-metadata-"));
  const codex = path.join(directory, "codex");
  const ocr = path.join(directory, "ocr");
  try {
    await writeFile(ocr, `#!/bin/sh\nprintf '%s' '{"lines":[{"text":"What is 2 + 2?","confidence":1},{"text":"A. 3","confidence":1},{"text":"B. 4","confidence":1}]}'\n`);
    await writeFile(codex, fakeCodexScript(`out=''\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi; shift; done\nprintf '%s' '{"question_text":"What is 2 + 2?","option_label":"B","option_number":"","answer_text":"4","confidence":1}' > "$out"`));
    await Promise.all([chmod(codex, 0o700), chmod(ocr, 0o700)]);
    const answer = await runCodex(Buffer.from("synthetic pixels"), await preflightCodexPath(codex), 5, "gpt-5.6-luna", "medium", { ocrExecutable: ocr });
    assert.equal(`${answer.label} — ${answer.text}`, "B — 4");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("production exec rejects a successful answer when resolved model mismatches", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-mismatch-metadata-"));
  const codex = path.join(directory, "codex");
  const ocr = path.join(directory, "ocr");
  try {
    await writeFile(ocr, `#!/bin/sh\nprintf '%s' '{"lines":[{"text":"Synthetic question","confidence":1}]}'\n`);
    await writeFile(codex, fakeCodexScript(`out=''\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi; shift; done\nprintf '%s' '{"question_text":"Synthetic question","option_label":"","option_number":"","answer_text":"Valid-looking answer","confidence":1}' > "$out"`, 'echo "model: gpt-5.6-sol" >&2\necho "reasoning effort: medium" >&2'));
    await Promise.all([chmod(codex, 0o700), chmod(ocr, 0o700)]);
    await assert.rejects(runCodex(Buffer.from("synthetic pixels"), await preflightCodexPath(codex), 5, "gpt-5.6-luna", "medium", { ocrExecutable: ocr }), /resolved gpt-5\.6-sol\/medium instead of gpt-5\.6-luna\/medium/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("production exec rejects successful output with missing resolved metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-missing-metadata-"));
  const codex = path.join(directory, "codex");
  const ocr = path.join(directory, "ocr");
  try {
    await writeFile(ocr, `#!/bin/sh\nprintf '%s' '{"lines":[{"text":"Synthetic question","confidence":1}]}'\n`);
    await writeFile(codex, fakeCodexScript(`out=''\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi; shift; done\nprintf '%s' '{"question_text":"Synthetic question","option_label":"","option_number":"","answer_text":"Valid-looking answer","confidence":1}' > "$out"`, ":"));
    await Promise.all([chmod(codex, 0o700), chmod(ocr, 0o700)]);
    await assert.rejects(runCodex(Buffer.from("synthetic pixels"), await preflightCodexPath(codex), 5, "gpt-5.6-luna", "medium", { ocrExecutable: ocr }), /exactly one authoritative model and one reasoning metadata line/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("production exec rejects contradictory metadata after an exact pair", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-contradictory-metadata-"));
  const codex = path.join(directory, "codex");
  const ocr = path.join(directory, "ocr");
  try {
    await writeFile(ocr, `#!/bin/sh\nprintf '%s' '{"lines":[{"text":"Synthetic question","confidence":1}]}'\n`);
    const metadata = "echo 'model: gpt-5.6-luna' >&2\necho 'reasoning effort: medium' >&2\necho 'model: gpt-5.6-sol' >&2\necho 'reasoning effort: high' >&2";
    await writeFile(codex, fakeCodexScript(`out=''\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi; shift; done\nprintf '%s' '{"question_text":"Synthetic question","option_label":"","option_number":"","answer_text":"Valid-looking answer","confidence":1}' > "$out"`, metadata));
    await Promise.all([chmod(codex, 0o700), chmod(ocr, 0o700)]);
    await assert.rejects(runCodex(Buffer.from("synthetic pixels"), await preflightCodexPath(codex), 5, "gpt-5.6-luna", "medium", { ocrExecutable: ocr }), /received 2 model and 2 reasoning lines/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("preflight rejects a wrong executable before any sensitive helper runs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-wrong-executable-"));
  const executable = path.join(directory, "codex");
  try {
    await writeFile(executable, "#!/bin/sh\necho 'unrelated utility 1.0'\n");
    await chmod(executable, 0o700);
    await assert.rejects(preflightCodexPath(executable), /does not identify itself as Codex CLI.*No capture was sent/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("identity binding rejects executable swap before screenshot workspace or OCR", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-executable-swap-"));
  const executable = path.join(directory, "codex");
  const replacement = path.join(directory, "replacement");
  const ocr = path.join(directory, "ocr");
  const ocrMarker = path.join(directory, "ocr-ran");
  try {
    await writeFile(executable, fakeCodexScript("exit 0"));
    await chmod(executable, 0o700);
    const verified = await preflightCodexPath(executable);
    await writeFile(replacement, fakeCodexScript("exit 0"));
    await chmod(replacement, 0o700);
    await (await import("node:fs/promises")).rename(replacement, executable);
    await writeFile(ocr, `#!/bin/sh\ntouch "${ocrMarker}"\nexit 1\n`);
    await chmod(ocr, 0o700);
    await assert.rejects(runCodex(Buffer.from("sensitive pixels"), verified, 5, "gpt-5.6-luna", "medium", { ocrExecutable: ocr }), /executable changed after validation.*No capture was sent/i);
    await assert.rejects(access(ocrMarker));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("resolved metadata parser requires exact model and reasoning", () => {
  assert.doesNotThrow(() => assertCodexExecutionMetadata("model: gpt-5.3-codex-spark\nreasoning effort: medium\n", "gpt-5.3-codex-spark", "medium"));
  assert.throws(() => assertCodexExecutionMetadata("model: gpt-5.3-codex-spark\n", "gpt-5.3-codex-spark", "medium"), /received 1 model and 0 reasoning lines/);
  assert.throws(() => assertCodexExecutionMetadata("model: gpt-5.3-codex-spark\nreasoning effort: medium\nmodel: gpt-5.3-codex-spark\nreasoning effort: medium\n", "gpt-5.3-codex-spark", "medium"), /received 2 model and 2 reasoning lines/);
  assert.throws(() => assertCodexExecutionMetadata("model: gpt-5.3-codex-spark\nreasoning effort: medium\nmodel: gpt-5.6-sol\nreasoning effort: high\n", "gpt-5.3-codex-spark", "medium"), /received 2 model and 2 reasoning lines/);
  assert.throws(() => assertCodexExecutionMetadata("model: gpt-5.3-codex-spark\nreasoning effort: medium\nreasoning effort: medium\n", "gpt-5.3-codex-spark", "medium"), /received 1 model and 2 reasoning lines/);
  assert.throws(() => assertCodexExecutionMetadata("model:\nreasoning effort: medium\n", "gpt-5.3-codex-spark", "medium"), /empty authoritative model/);
});

test("packaged-app discovery includes safe common package-manager bins", () => {
  const details = codexCandidateDetails("", { PATH: "" }, "/Users/qa-fixture");
  assert.ok(details.some((candidate) => candidate.path === "/opt/homebrew/bin/codex"));
  assert.ok(details.some((candidate) => candidate.path === "/usr/local/bin/codex"));
  assert.ok(details.some((candidate) => candidate.path === "/Users/qa-fixture/.local/bin/codex"));
  assert.ok(details.some((candidate) => candidate.source.includes("ChatGPT.app")));
});

test("a missing saved executable never silently falls back", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-saved-override-"));
  try {
    const fallback = path.join(directory, "codex");
    await writeFile(fallback, "#!/bin/sh\nexit 0\n");
    await chmod(fallback, 0o700);
    await assert.rejects(resolveCodex(path.join(directory, "missing-codex"), { PATH: directory }, directory, path.join(directory, "Applications")), /saved Codex executable is missing/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("model validation rejects a CLI-reported fallback", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-model-fallback-"));
  const executable = path.join(directory, "codex");
  try {
    await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'codex-cli 1.0'; exit 0; fi\nif [ \"$1\" = \"login\" ]; then exit 0; fi\necho 'model: gpt-5.6-sol' >&2\necho 'reasoning effort: medium' >&2\necho OK\n");
    await chmod(executable, 0o700);
    const result = await testCodex(executable, "gpt-5.6-luna", "medium");
    assert.equal(result.connectionStatus, "model-unavailable");
    assert.match(result.message, /No fallback was accepted/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed codex --version is a degraded error, never ready", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cheatykitty-version-failure-"));
  const executable = path.join(directory, "codex");
  try {
    await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'version command failed' >&2; exit 7; fi\nexit 0\n");
    await chmod(executable, 0o700);
    const diagnostic = await inspectCodex(executable);
    assert.equal(diagnostic.status, "error");
    assert.equal(diagnostic.connectionStatus, "Version check failed");
    assert.equal(diagnostic.version, "Unavailable");
    assert.match(diagnostic.message, /codex --version/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("long process diagnostics retain beginning and end within a bounded message", () => {
  const compact = compactProcessDiagnostic(`BEGIN ${"noise ".repeat(200)} FINAL`, 180);
  assert.ok(compact.length <= 180);
  assert.match(compact, /^BEGIN/);
  assert.match(compact, /FINAL$/);
  assert.match(compact, /details omitted/);
});

test("process diagnostics redact credential-like values and email addresses", () => {
  const redacted = redactSensitiveDiagnostic(["Authorization: Bearer secret-value", ["access", "token"].join("_") + "=another-secret", "qa.user@" + "example.test"].join(" "));
  assert.doesNotMatch(redacted, /secret-value|another-secret|qa\.user/);
  assert.match(redacted, /REDACTED/);
});

test("removes temporary screenshot and outputs after failure", async () => {
  let workspace = "";
  await assert.rejects(withTempWorkspace(Buffer.from("png"), async (paths) => {
    workspace = paths.workDir;
    await access(paths.imagePath);
    throw new Error("simulated failure");
  }), /simulated failure/);
  await assert.rejects(access(workspace));
});

test("removes temporary screenshot, schema, and output after success", async () => {
  let workspace = "";
  const result = await withTempWorkspace(Buffer.from("png"), async (paths) => {
    workspace = paths.workDir;
    await Promise.all([access(paths.imagePath), access(paths.schemaPath)]);
    const schema = JSON.parse(await (await import("node:fs/promises")).readFile(paths.schemaPath, "utf8"));
    assert.deepEqual(schema.required, ["question_text", "option_label", "option_number", "answer_text", "confidence"]);
    assert.equal("reason" in schema.properties, false);
    await writeFile(paths.outputPath, "result");
    await access(paths.outputPath);
    return "ok";
  });
  assert.equal(result, "ok");
  await assert.rejects(access(workspace));
});
