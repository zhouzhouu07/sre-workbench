import { spawn } from "node:child_process";
import electron from "electron";
await import("./build.mjs");
const child = spawn(electron, ["."], { stdio: "inherit", windowsHide: true });
child.on("exit", (code) => process.exit(code ?? 0));
