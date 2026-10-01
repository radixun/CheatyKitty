import assert from "node:assert/strict";
import test from "node:test";
import { AutoCaptureScheduler } from "../src/auto-scheduler";

test("Auto uses the selected interval, skips ticks while busy, and has no catch-up queue", () => {
  let callback: (() => void) | undefined;
  let interval = 0;
  let busy = false;
  let captures = 0;
  const scheduler = new AutoCaptureScheduler({ setInterval(next, ms) { callback = next; interval = ms; return 1; }, clearInterval() { callback = undefined; } }, 7000, () => { if (!busy) { busy = true; captures += 1; } });
  scheduler.start();
  assert.equal(interval, 7000);
  assert.equal(captures, 0);
  callback?.();
  assert.equal(captures, 1);
  callback?.(); callback?.();
  assert.equal(captures, 1);
  busy = false;
  callback?.();
  assert.equal(captures, 2);
  scheduler.stop();
  assert.equal(scheduler.active, false);
});

test("interval change immediately replaces one active timer without duplicates", () => {
  let clears = 0; const starts: number[] = [];
  const scheduler = new AutoCaptureScheduler({ setInterval(_callback, ms) { starts.push(ms); return starts.length; }, clearInterval() { clears += 1; } }, 5000, () => {});
  scheduler.start(); scheduler.setIntervalMs(12000); scheduler.stop();
  assert.deepEqual(starts, [5000, 12000]);
  assert.equal(clears, 2);
});
