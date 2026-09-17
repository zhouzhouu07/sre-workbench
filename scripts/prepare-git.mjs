import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const version = "2.55.0";
const sha256 =
  "31497e7968196332263459ee319d2524e3ebc5786ab895e2abad34ffdd4f4ebf";
const destination = resolve("vendor/git");
const archive = resolve(".tools/MinGit-" + version + "-64-bit.zip");
try {
  await access(destination + "/cmd/git.exe");
  console.log("Bundled Git already present.");
  process.exit(0);
} catch {}
await mkdir(".tools", { recursive: true });
await mkdir(destination, { recursive: true });
let bytes;
try {
  bytes = await readFile(archive);
} catch {
  console.log("Downloading official MinGit " + version);
  const response = await fetch(
    `https://github.com/git-for-windows/git/releases/download/v${version}.windows.1/MinGit-${version}-64-bit.zip`,
  );
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(archive, bytes);
}
if (createHash("sha256").update(bytes).digest("hex") !== sha256)
  throw new Error("MinGit SHA256 mismatch");
await new Promise((res, rej) => {
  const child = spawn("tar.exe", ["-xf", archive, "-C", destination], {
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", rej);
  child.on("exit", (code) =>
    code === 0 ? res() : rej(new Error("Archive extraction failed")),
  );
});
console.log(
  "Verified MinGit " + version + " ready in vendor/git (license included).",
);
