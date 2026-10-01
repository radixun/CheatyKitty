import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { IconIcns } = require("@shockpkg/icon-encoder");
const run = promisify(execFile);
const source = "assets/cheatykitty-icon.png";
const iconset = "build/CheatyKitty.iconset";
const output = "build/CheatyKitty.icns";
const variants = [
  [16, "icon_16x16.png", ["ic04"]],
  [32, "icon_16x16@2x.png", ["ic11"]],
  [32, "icon_32x32.png", ["ic05"]],
  [64, "icon_32x32@2x.png", ["ic12"]],
  [128, "icon_128x128.png", ["ic07"]],
  [256, "icon_128x128@2x.png", ["ic13"]],
  [256, "icon_256x256.png", ["ic08"]],
  [512, "icon_256x256@2x.png", ["ic14"]],
  [512, "icon_512x512.png", ["ic09"]],
  [1024, "icon_512x512@2x.png", ["ic10"]]
];

if (process.platform !== "darwin") throw new Error("CheatyKitty ICNS generation requires macOS for its verification pipeline.");
await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });
for (const [size, name] of variants) {
  await run("sips", ["-z", String(size), String(size), source, "--out", `${iconset}/${name}`]);
}
const icns = new IconIcns();
icns.toc = true;
for (const [, name, types] of variants) {
  await icns.addFromPng(await readFile(`${iconset}/${name}`), types);
}
for (const entry of icns.entries) {
  if (entry.type === "ic04" || entry.type === "ic05") {
    // macOS 26 iconutil drops the final blue sample when a small ARGB PackBits
    // stream ends exactly at the chunk boundary. A terminal padding byte is
    // ignored as trailing chunk data and keeps the complete decoded raster.
    entry.data = Uint8Array.from([...entry.data, 0]);
  }
}
await writeFile(output, icns.encode());
await rm(iconset, { recursive: true, force: true });
