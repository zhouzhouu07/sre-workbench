import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  readdir,
  realpath,
  open,
  mkdir,
  writeFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, relative, isAbsolute, resolve, dirname, sep } from "node:path";
import type { DeploymentSpec } from "../../shared/types";

const excluded =
  /^(?:\.git|\.svn|\.hg|node_modules|\.venv|venv|__pycache__|\.ssh|\.aws|\.azure|\.npmrc|\.pypirc|\.netrc|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore)|id_rsa(?:\..*)?|id_ed25519(?:\..*)?)$/i;
export interface SourceFile {
  path: string;
  relative: string;
  size: number;
  ino: number;
  mtimeMs: number;
}
export async function safeFiles(root: string): Promise<SourceFile[]> {
  const base = await realpath(root);
  if (!(await lstat(base)).isDirectory()) throw new Error("源码必须为目录");
  const files: SourceFile[] = [];
  let bytes = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 32) throw new Error("源码目录层数超过 32");
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (excluded.test(entry.name)) continue;
      if (/[\x00-\x1f\\]/.test(entry.name))
        throw new Error("源码含不安全文件名");
      const path = join(dir, entry.name),
        stat = await lstat(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      const rel = relative(base, path);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error("源码路径越界");
      bytes += stat.size;
      if (
        stat.size > 20_000_000 ||
        bytes > 200_000_000 ||
        files.length >= 10000
      )
        throw new Error("源码超出 10000 文件 / 200MB 总量 / 20MB 单文件限制");
      files.push({
        path,
        relative: rel.split(sep).join("/"),
        size: stat.size,
        ino: stat.ino,
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  await walk(base, 0);
  if (!files.length) throw new Error("过滤后没有可上传的源码");
  return files;
}
export function validateGitURL(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("Git 地址必须为不含凭据、查询或片段的 HTTPS URL");
  return url.toString();
}
async function git(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let err = "";
    let exceeded = false;
    const timer = setTimeout(() => {
      exceeded = true;
      child.kill();
    }, 300000);
    child.stderr.on("data", (c: Buffer) => {
      err = (err + c.toString()).slice(-10000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !exceeded) resolvePromise();
      else
        reject(
          new Error(
            exceeded ? "Git 操作超时" : `Git 操作失败 (${code})：${err}`,
          ),
        );
    });
  });
}
/** Local scripts are never executed. A detached copy closes upload races and contains no VCS credentials. */
export async function stageSource(
  spec: DeploymentSpec,
  options: { gitPath: string; tempDir: string },
  token?: string,
): Promise<{
  directory: string;
  files: SourceFile[];
  cleanup: () => Promise<void>;
}> {
  await mkdir(options.tempDir, { recursive: true });
  const directory = await mkdtemp(join(options.tempDir, "source-"));
  const snapshot = join(directory, "snapshot");
  await mkdir(snapshot);
  try {
    let source = resolve(spec.source);
    if (spec.sourceType === "git") {
      source = join(directory, "checkout");
      const askpass = join(directory, "askpass.sh");
      await writeFile(
        askpass,
        '#!/bin/sh\ncase "$1" in *Username*) printf "%s" "oauth2" ;; *) printf "%s" "$SRE_GIT_TOKEN" ;; esac\n',
        { mode: 0o700 },
      );
      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: askpass,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_TRACE: "0",
        GIT_CURL_VERBOSE: "0",
        SRE_GIT_TOKEN: token || "",
      };
      await mkdir(source);
      await git(options.gitPath, ["init", "--quiet"], source, env);
      await git(
        options.gitPath,
        [
          "-c",
          "credential.helper=",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "protocol.file.allow=never",
          "fetch",
          "--depth",
          "1",
          "--no-tags",
          "--",
          validateGitURL(spec.source),
          spec.gitRef,
        ],
        source,
        env,
      );
      await git(
        options.gitPath,
        [
          "-c",
          "core.hooksPath=/dev/null",
          "checkout",
          "--detach",
          "FETCH_HEAD",
        ],
        source,
        env,
      );
    }
    const files = await safeFiles(source);
    for (const file of files) {
      const handle = await open(
        file.path,
        constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
      );
      try {
        const before = await handle.stat();
        if (
          !before.isFile() ||
          before.ino !== file.ino ||
          before.size !== file.size ||
          before.mtimeMs !== file.mtimeMs
        )
          throw new Error("源码在准备期间发生改变，请重试");
        const content = await handle.readFile();
        const after = await handle.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
          throw new Error("源码在读取期间发生改变");
        const destination = join(snapshot, ...file.relative.split("/"));
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content, {
          mode: before.mode & 0o111 ? 0o700 : 0o600,
        });
      } finally {
        await handle.close();
      }
    }
    return {
      directory: snapshot,
      files: await safeFiles(snapshot),
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
