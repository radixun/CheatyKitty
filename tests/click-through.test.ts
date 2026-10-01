import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PointerRegionTracker, shouldIgnoreMainMouseEvents, type HitRegions } from "../src/click-through";

test("main overlay accepts input only on brand drag, Settings, and Quit hotspots", () => {
  assert.equal(shouldIgnoreMainMouseEvents({ pointerRegion: "none" }), true);
  assert.equal(shouldIgnoreMainMouseEvents({ pointerRegion: "drag" }), false);
  assert.equal(shouldIgnoreMainMouseEvents({ pointerRegion: "settings" }), false);
  assert.equal(shouldIgnoreMainMouseEvents({ pointerRegion: "quit" }), false);
});

test("main-process hit testing reaches none -> drag and fails safe back to none", () => {
  const regions: HitRegions = {
    drag: { x: 10, y: 0, width: 92, height: 46 },
    settings: { x: 550, y: 1, width: 44, height: 44 },
    quit: { x: 595, y: 1, width: 44, height: 44 }
  };
  const tracker = new PointerRegionTracker();
  assert.deepEqual(tracker.update(regions, { x: 300, y: 100 }), { changed: false, region: "none" });
  assert.deepEqual(tracker.update(regions, { x: 30, y: 20 }), { changed: true, region: "drag" });
  assert.equal(shouldIgnoreMainMouseEvents({ pointerRegion: tracker.current }), false);
  assert.deepEqual(tracker.update(regions, { x: 300, y: 100 }), { changed: true, region: "none" });
  assert.equal(shouldIgnoreMainMouseEvents({ pointerRegion: tracker.current }), true);
  assert.deepEqual(tracker.update(null, { x: 30, y: 20 }), { changed: false, region: "none" });
});

test("drag activation is driven by main-process cursor polling, not drag-region pointer events", async () => {
  const [main, renderer] = await Promise.all([readFile("src/main.ts", "utf8"), readFile("src/renderer/renderer.js", "utf8")]);
  assert.match(main, /screen\.getCursorScreenPoint\(\)/);
  assert.match(main, /setInterval\(pollPointerRegion, 40\)/);
  assert.match(renderer, /setHitRegions/);
  assert.doesNotMatch(renderer, /mouseenter|mouseleave|setPointerRegion/);
});
