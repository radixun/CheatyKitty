import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const excludedDirectories = new Set([".git", ".agent-work", "node_modules", "build", "dist", "release", "artifacts", "coverage", "screenshots", "captures", "recordings", "evidence", "proof", "signing", ".vscode", ".idea"]);
const allowedBinaryFiles = new Set([
  "assets/cheatykitty-icon.png",
  "docs/media/main-result.png",
  "docs/media/settings.png",
  "docs/media/synthetic-demo.gif"
]);
const forbiddenNames = new Set([".DS_Store", "Thumbs.db", "settings.json"]);
const findings = [];

const patterns = [
  ["personal path or memory-system reference", new RegExp(`${["leonid", "kuznetsov"].join("")}|codex[_-]second[_-]brain|/Users/${"leo" + "nid"}(?:/|\\b)`, "giu")],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/gu],
  ["credential assignment", /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{12,}/giu],
  ["cookie or session assignment", /\b(?:cookie|session[_-]?(?:id|token))\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{16,}/giu],
  ["non-fixture email", /\b[A-Za-z0-9._%+-]+@(?=[A-Za-z])(?!example\.(?:com|test)\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/giu]
];

export async function filesBelow(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.name === ".git") continue;
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) output.push(...await filesBelow(path.join(directory, entry.name), relative));
    } else output.push(relative);
  }
  return output;
}

function scan(label, text, sourcePath = label) {
  for (const [description, pattern] of patterns) {
    if (sourcePath === "package-lock.json" && description === "non-fixture email") continue;
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) findings.push(`${label}: ${description} near ${JSON.stringify(match[0].slice(0, 80))}`);
  }
}

async function main() {
  const files = await filesBelow(root);
  for (const relative of files) {
    const basename = path.basename(relative);
    if (forbiddenNames.has(basename)) findings.push(`${relative}: forbidden local/generated file name`);
    if (/\.(?:dmg|blockmap|log|map|pem|key|p12|mobileprovision|env)$/iu.test(relative)) findings.push(`${relative}: release, log, source-map, credential, or environment artifact`);
    if (/\.(?:har|pcap|trace|jsonl)$/iu.test(relative)) findings.push(`${relative}: raw network/runtime evidence artifact`);
    if (/\.(?:json|txt)$/iu.test(relative) && !/^package(?:-lock)?\.json$/u.test(relative)) {
      const text = (await readFile(path.join(root, relative))).toString("utf8");
      if (/"(?:question_text|answer_text|ocrText|ocr_text|prompt|screenshot|captureData|rawOutput)"\s*:/u.test(text) || /(?:^|\/)(?:ocr|question|answer|evidence|screenshot|capture)[^/]*\.(?:json|txt)$/iu.test(relative)) {
        findings.push(`${relative}: possible raw OCR/question/answer/capture evidence outside an explicit synthetic code fixture`);
      }
    }
    if (/\.(?:png|jpe?g|gif|webp|icns)$/iu.test(relative) && !allowedBinaryFiles.has(relative)) findings.push(`${relative}: unapproved image; only reviewed synthetic/brand assets may be committed`);
    const bytes = await readFile(path.join(root, relative));
    if (bytes.length <= 5 * 1024 * 1024 && !bytes.includes(0)) scan(relative, bytes.toString("utf8"));
  }

  try {
    const [{ stdout: commitList }, { stdout: metadata }] = await Promise.all([
      run("git", ["rev-list", "--all"], { cwd: root, encoding: "utf8" }),
      run("git", ["log", "--all", "--format=%H%n%an%n%ae%n%B"], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
    ]);
    scan("git history metadata", metadata);
    for (const commit of commitList.trim().split("\n").filter(Boolean)) {
      const { stdout: tree } = await run("git", ["ls-tree", "-r", "--name-only", commit], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
      for (const relative of tree.trim().split("\n").filter(Boolean)) {
        const { stdout: bytes } = await run("git", ["show", `${commit}:${relative}`], { cwd: root, encoding: "buffer", maxBuffer: 6 * 1024 * 1024 });
        if (bytes.length <= 5 * 1024 * 1024 && !bytes.includes(0)) scan(`git history ${commit.slice(0, 12)}:${relative}`, bytes.toString("utf8"), relative);
      }
    }
  } catch (error) {
    const diagnostic = `${String(error)} ${error && typeof error === "object" && "stderr" in error ? String(error.stderr) : ""}`;
    if (!/does not have any commits|bad default revision|unknown revision|not a git repository/i.test(diagnostic)) throw error;
  }

  if (findings.length) throw new Error(`Repository hygiene check found ${findings.length} issue(s):\n- ${findings.join("\n- ")}`);
  console.log(`Repository hygiene check passed for ${files.length} intended files and available Git history. This targeted check reduces risk but does not prove that every possible secret or personal datum is absent.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
