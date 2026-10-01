export type PointerRegion = "none" | "drag" | "settings" | "quit";
export type InteractiveRegion = Exclude<PointerRegion, "none">;
export interface Point { x: number; y: number; }
export interface RegionRect extends Point { width: number; height: number; }
export type HitRegions = Record<InteractiveRegion, RegionRect>;
export interface ClickThroughContext { pointerRegion: PointerRegion; }

export function shouldIgnoreMainMouseEvents(context: ClickThroughContext): boolean {
  return context.pointerRegion === "none";
}

function contains(rect: RegionRect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export function hitTestPointerRegion(regions: HitRegions | null, point: Point): PointerRegion {
  if (!regions) return "none";
  if (contains(regions.quit, point)) return "quit";
  if (contains(regions.settings, point)) return "settings";
  if (contains(regions.drag, point)) return "drag";
  return "none";
}

export class PointerRegionTracker {
  private value: PointerRegion = "none";
  get current(): PointerRegion { return this.value; }
  update(regions: HitRegions | null, point: Point): { changed: boolean; region: PointerRegion } {
    const region = hitTestPointerRegion(regions, point);
    const changed = region !== this.value;
    this.value = region;
    return { changed, region };
  }
  reset(): { changed: boolean; region: "none" } {
    const changed = this.value !== "none";
    this.value = "none";
    return { changed, region: "none" };
  }
}
