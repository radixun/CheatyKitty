import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("capture path uses ScreenCaptureKit exclusion and has no hide/show/moveTop fallback", async () => {
  const [main, helper] = await Promise.all([readFile("src/main.ts", "utf8"), readFile("native/sck-capture.m", "utf8")]);
  const flow = main.slice(main.indexOf("async function runQaFlow"), main.indexOf("function cancelQaFlow"));
  assert.doesNotMatch(flow, /\.hide\(|\.show\(|moveTop|desktopCapturer/);
  assert.match(helper, /excludingApplications/);
  assert.match(helper, /processID == excludedPID/);
  assert.match(helper, /capture aborted/);
  assert.doesNotMatch(main, /desktopCapturer/);
});

test("build packages a native macOS Vision OCR helper", async () => {
  const [build, helper, packageJson] = await Promise.all([readFile("scripts/prepare-build.mjs", "utf8"), readFile("native/vision-ocr.m", "utf8"), readFile("package.json", "utf8")]);
  assert.match(build, /native\/vision-ocr\.m/);
  assert.match(build, /-framework", "Vision/);
  assert.match(helper, /VNRecognizeTextRequest/);
  assert.match(helper, /CheatyKitty OCR failed/);
  assert.match(packageJson, /dist\/native\/\*\*\/\*/);
  assert.match(build, /-arch", "arm64/);
  assert.match(build, /-mmacosx-version-min=14\.0/);
  assert.equal(JSON.parse(packageJson).build.mac.minimumSystemVersion, "14.0");
});

test("area selection crops the already-filtered image after full-display capture", async () => {
  const main = await readFile("src/main.ts", "utf8");
  assert.ok(main.indexOf("await captureDisplay()") < main.indexOf("await selectArea(image, display)"));
  assert.match(main, /resolve\(image\.crop/);
});

test("production Codex identity/auth preflight completes before screen capture", async () => {
  const main = await readFile("src/main.ts", "utf8");
  const flow = main.slice(main.indexOf("async function runQaFlow"), main.indexOf("function cancelQaFlow"));
  assert.ok(flow.indexOf("await preflightCodex") >= 0);
  assert.ok(flow.indexOf("await preflightCodex") < flow.indexOf("await captureDisplay()"));
});
