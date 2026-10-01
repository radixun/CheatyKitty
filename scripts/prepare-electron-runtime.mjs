import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const electronPackageRoot = path.dirname(fileURLToPath(import.meta.resolve("electron")));

// Electron 44 downloads its runtime lazily. Importing the package makes the
// pinned runtime and its redistribution notices available before packaging.
await import("electron");

await Promise.all([
  access(path.join(electronPackageRoot, "dist", "LICENSE")),
  access(path.join(electronPackageRoot, "dist", "LICENSES.chromium.html"))
]);

console.log("Electron runtime and redistribution notices are ready.");
