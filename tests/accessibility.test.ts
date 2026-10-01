import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("saved Q/A is not a live region; concise run status is isolated and atomic", async () => {
  const html = await readFile("src/renderer/index.html", "utf8");
  const columns = html.match(/<section id="resultColumns"[^>]*>/)?.[0] || "";
  const status = html.match(/<div id="runStatus"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(columns, /aria-live|aria-atomic|role=/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  assert.match(status, /aria-atomic="true"/);
});

test("retained progress uses a non-obscuring foreground row without blur or dimming", async () => {
  const [renderer, css] = await Promise.all([readFile("src/renderer/renderer.js", "utf8"), readFile("src/renderer/styles.css", "utf8")]);
  assert.match(renderer, /retained-progress/);
  assert.doesNotMatch(renderer, /classList\.toggle\("scrim"/);
  assert.doesNotMatch(css, /backdrop-filter|filter:\s*blur|rgba\(8,8,8/);
  assert.match(css, /\.column-progress\.retained-progress[^}]+background:transparent/);
  assert.match(css, /\.column-progress \{[^}]+pointer-events:none/);
});

test("model selector is one named radio group with exact option names", async () => {
  const html = await readFile("src/renderer/settings.html", "utf8");
  const group = html.match(/<fieldset id="modelSelector"[\s\S]*?<\/fieldset>/)?.[0] || "";
  assert.match(group, /role="radiogroup"/);
  assert.match(group, /aria-labelledby="modelSelectorLegend"/);
  assert.match(group, /<legend id="modelSelectorLegend">Choose one model and reasoning profile<\/legend>/);
  const radios = [...group.matchAll(/<input type="radio" name="modelMode"[^>]*>/g)].map((match) => match[0]);
  assert.equal(radios.length, 3);
  assert.deepEqual(radios.map((radio) => radio.match(/aria-label="([^"]+)"/)?.[1]), [
    "Default — 5.6 Luna · Medium",
    "5.6 Sol · Medium",
    "5.3 Codex Spark · Medium"
  ]);
  assert.equal(radios.filter((radio) => /\schecked(?:\s|\/>)/.test(radio)).length, 1);
});
