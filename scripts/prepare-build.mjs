import { rm, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/native", { recursive: true });
if (process.platform === "darwin") {
  const run = promisify(execFile);
  const common = ["clang", "-arch", "arm64", "-mmacosx-version-min=14.0", "-O2", "-fobjc-arc"];
  const environment = { ...process.env, CLANG_MODULE_CACHE_PATH: "/tmp/cheatykitty-clang-module-cache" };
  await run("xcrun", [...common, "native/sck-capture.m", "-framework", "AppKit", "-framework", "ScreenCaptureKit", "-o", "dist/native/sck-capture"], { env: environment });
  await run("xcrun", [...common, "native/vision-ocr.m", "-framework", "AppKit", "-framework", "Vision", "-o", "dist/native/vision-ocr"], { env: environment });
  for (const helper of ["dist/native/sck-capture", "dist/native/vision-ocr"]) {
    const { stdout } = await run("lipo", ["-archs", helper]);
    if (stdout.trim() !== "arm64") throw new Error(`${helper} must be a thin arm64 Mach-O, got: ${stdout.trim()}`);
  }
}
