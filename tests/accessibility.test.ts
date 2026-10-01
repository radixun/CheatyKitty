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

test("model and effort accept free input and FAST has an accessible checkbox", async () => {
  const html = await readFile("src/renderer/settings.html", "utf8");
  for (const id of ["modelId", "reasoningEffort", "fastMode"]) {
    assert.match(html, new RegExp(`for="${id}"`));
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="modelId" list="modelSuggestions"/);
  assert.match(html, /id="reasoningEffort" list="reasoningSuggestions"/);
  assert.match(html, /id="fastMode" type="checkbox"/);
  assert.doesNotMatch(html, /name="modelMode"/);
});
