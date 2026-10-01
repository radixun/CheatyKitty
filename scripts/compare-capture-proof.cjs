const { app, nativeImage } = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.whenReady().then(async () => {
  try {
    const directory = path.resolve(process.argv[2]);
    const [baseline, filtered, raw, geometry] = await Promise.all([
      readFile(path.join(directory, "hidden-baseline.png")), readFile(path.join(directory, "packaged-filtered.png")),
      readFile(path.join(directory, "raw-visible.png")), readFile(path.join(directory, "packaged-filtered.geometry.json"), "utf8").then(JSON.parse)
    ]);
    const images = [baseline, filtered, raw].map((data) => nativeImage.createFromBuffer(data));
    const size = images[1].getSize();
    if (images.some((image) => image.isEmpty() || image.getSize().width !== size.width || image.getSize().height !== size.height)) throw new Error("Capture proof images are empty or have mismatched dimensions");
    const scaleX = size.width / geometry.display.bounds.width;
    const scaleY = size.height / geometry.display.bounds.height;
    const cropBounds = { x: Math.round((geometry.overlay.x - geometry.display.bounds.x) * scaleX), y: Math.round((geometry.overlay.y - geometry.display.bounds.y) * scaleY), width: Math.round(geometry.overlay.width * scaleX), height: Math.round(geometry.overlay.height * scaleY) };
    const bitmaps = images.map((image) => image.crop(cropBounds).toBitmap());
    let filteredMismatch = 0, rawMismatch = 0, filteredDelta = 0, darkPixels = 0;
    const pixels = bitmaps[0].length / 4;
    for (let offset = 0; offset < bitmaps[0].length; offset += 4) {
      let fd = 0, rd = 0;
      for (let channel = 0; channel < 3; channel++) { fd += Math.abs(bitmaps[0][offset + channel] - bitmaps[1][offset + channel]); rd += Math.abs(bitmaps[0][offset + channel] - bitmaps[2][offset + channel]); }
      if (fd) filteredMismatch += 1;
      if (rd) rawMismatch += 1;
      filteredDelta += fd / 3;
      if (bitmaps[1][offset] < 4 && bitmaps[1][offset + 1] < 4 && bitmaps[1][offset + 2] < 4) darkPixels += 1;
    }
    const evidence = { imageSize: size, cropBounds, pixels, filteredVsHiddenMismatchRatio: filteredMismatch / pixels, filteredVsHiddenMeanDelta: filteredDelta / pixels, rawVisibleVsHiddenMismatchRatio: rawMismatch / pixels, filteredNearBlackRatio: darkPixels / pixels, helperPIDExcluded: geometry.helperPIDExcluded };
    await writeFile(path.join(directory, "comparison.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.filteredVsHiddenMismatchRatio > .03 || evidence.filteredVsHiddenMeanDelta > .5) throw new Error(`Filtered capture is not comparable to hidden baseline: ${JSON.stringify(evidence)}`);
    if (evidence.rawVisibleVsHiddenMismatchRatio < .02) throw new Error(`Raw capture did not visibly contain CheatyKitty: ${JSON.stringify(evidence)}`);
    if (evidence.filteredNearBlackRatio > .98) throw new Error(`Filtered overlay region is black/transparent: ${JSON.stringify(evidence)}`);
    console.log(`Packaged ScreenCaptureKit proof passed: ${JSON.stringify(evidence)}`);
    app.exit(0);
  } catch (error) { console.error(error instanceof Error ? error.stack : String(error)); app.exit(1); }
});
