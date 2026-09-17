import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/main", { recursive: true });
await build({
  entryPoints: ["src/main/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main/index.cjs",
  external: ["electron", "ssh2", "sql.js"],
  sourcemap: true,
});
await build({
  entryPoints: ["src/main/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main/preload.cjs",
  external: ["electron"],
});
await copyFile(
  "node_modules/sql.js/dist/sql-wasm.wasm",
  "dist/main/sql-wasm.wasm",
);
await copyFile("assets/icon.png", "dist/main/icon.png");
await viteBuild();
