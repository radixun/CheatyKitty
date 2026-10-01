export interface TimerApi {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export class AutoCaptureScheduler {
  private handle: unknown = null;
  constructor(private readonly timers: TimerApi, private intervalMs: number, private readonly tick: () => void) {}
  get active(): boolean { return this.handle !== null; }
  start(): void { this.stop(); this.handle = this.timers.setInterval(this.tick, this.intervalMs); }
  setIntervalMs(intervalMs: number): void {
    const wasActive = this.active;
    this.stop();
    this.intervalMs = intervalMs;
    if (wasActive) this.start();
  }
  stop(): void { if (this.handle !== null) this.timers.clearInterval(this.handle); this.handle = null; }
}
