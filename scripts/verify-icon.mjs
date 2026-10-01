import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pngjs from "pngjs";

const { PNG } = pngjs;
const run = promisify(execFile);
const source = "assets/cheatykitty-icon.png";
const icns = process.argv[2] || "build/CheatyKitty.icns";
const artifacts = "artifacts";
const variants = [
  ["16x16 1x", "icon_16x16.png", 16],
  ["16x16 2x", "icon_16x16@2x.png", 32],
  ["32x32 1x", "icon_32x32.png", 32],
  ["32x32 2x", "icon_32x32@2x.png", 64],
  ["128x128 1x", "icon_128x128.png", 128],
  ["128x128 2x", "icon_128x128@2x.png", 256],
  ["256x256 1x", "icon_256x256.png", 256],
  ["256x256 2x", "icon_256x256@2x.png", 512],
  ["512x512 1x", "icon_512x512.png", 512],
  ["512x512 2x", "icon_512x512@2x.png", 1024]
];

if (process.platform !== "darwin") throw new Error("CheatyKitty icon verification requires macOS iconutil and sips.");
const temporary = await mkdtemp(path.join(os.tmpdir(), "cheatykitty-icon-audit-"));
try {
  const extracted = path.join(temporary, "CheatyKitty.iconset");
  const references = path.join(temporary, "reference");
  await mkdir(references);
  await run("iconutil", ["-c", "iconset", icns, "-o", extracted]);

  const referenceBySize = new Map();
  for (const [, , size] of variants) {
    if (referenceBySize.has(size)) continue;
    const output = path.join(references, `${size}.png`);
    await run("sips", ["-z", String(size), String(size), source, "--out", output]);
    referenceBySize.set(size, output);
  }

  const metrics = [];
  const decoded = [];
  for (const [label, file, size] of variants) {
    const actual = PNG.sync.read(await readFile(path.join(extracted, file)));
    const reference = PNG.sync.read(await readFile(referenceBySize.get(size)));
    if (actual.width !== size || actual.height !== size) throw new Error(`${file}: extracted ${actual.width}x${actual.height}, expected ${size}x${size}.`);
    let absoluteError = 0;
    let squaredError = 0;
    let maximumError = 0;
    let mismatchedSamples = 0;
    for (let index = 0; index < actual.data.length; index += 1) {
      const difference = Math.abs(actual.data[index] - reference.data[index]);
      absoluteError += difference;
      squaredError += difference * difference;
      maximumError = Math.max(maximumError, difference);
      if (difference !== 0) mismatchedSamples += 1;
    }
    const samples = actual.data.length;
    const result = {
      label, file, size,
      mismatchedSamples,
      mismatchRatio: mismatchedSamples / samples,
      meanAbsoluteError: absoluteError / samples,
      rootMeanSquareError: Math.sqrt(squaredError / samples),
      maximumError
    };
    if (mismatchedSamples !== 0) throw new Error(`${file}: extracted raster differs from independent canonical downscale: ${JSON.stringify(result)}`);
    metrics.push(result);
    decoded.push([actual, reference]);
  }

  const cellWidth = 280;
  const cellHeight = 160;
  const columns = 5;
  const sheet = new PNG({ width: cellWidth * columns, height: cellHeight * 2, colorType: 6 });
  sheet.data.fill(28);
  for (let index = 0; index < decoded.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const originX = column * cellWidth;
    const originY = row * cellHeight;
    const color = [70 + index * 13, 230 - index * 11, 150 + index * 7, 255].map((value) => Math.max(0, Math.min(255, value)));
    for (let y = 0; y < 6; y += 1) for (let x = 0; x < cellWidth; x += 1) color.forEach((value, channel) => { sheet.data[((originY + y) * sheet.width + originX + x) * 4 + channel] = value; });
    for (let side = 0; side < 2; side += 1) {
      const image = decoded[index][side];
      const target = 128;
      const startX = originX + 6 + side * 138;
      const startY = originY + 18;
      for (let y = 0; y < target; y += 1) for (let x = 0; x < target; x += 1) {
        const sourceX = Math.min(image.width - 1, Math.floor(x * image.width / target));
        const sourceY = Math.min(image.height - 1, Math.floor(y * image.height / target));
        const from = (sourceY * image.width + sourceX) * 4;
        const to = ((startY + y) * sheet.width + startX + x) * 4;
        image.data.copy(sheet.data, to, from, from + 4);
      }
    }
  }

  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, "cheatykitty-icon-contact-sheet.png"), PNG.sync.write(sheet));
  await writeFile(path.join(artifacts, "cheatykitty-icon-audit.json"), `${JSON.stringify({ source, icns, convention: "Each cell is extracted ICNS on the left and independent sips reference on the right; variants follow metrics order.", metrics }, null, 2)}\n`);
  console.log(`CheatyKitty ICNS pixel audit passed: ${metrics.length}/${metrics.length} representations exactly match independent canonical downscales.`);
  console.log(path.resolve(artifacts, "cheatykitty-icon-contact-sheet.png"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
