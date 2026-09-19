import { expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderJobWrapper } from "../src/main/core/tasks";

it("persists short stdout and stderr while a remote job is still running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sre-live-output-"));
  writeFileSync(
    join(dir, "work.sh"),
    `printf 'first progress\\n'
printf 'diagnostic\\n' >&2
touch ./ready
for ((i=0; i<100; i++)); do
  test -f ./release && break
  sleep 0.05
done
exit 7
`,
  );
  writeFileSync(
    join(dir, "run.sh"),
    renderJobWrapper(dir.replaceAll("\\", "/")),
  );
  const child = spawn(
    process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash",
    [join(dir, "run.sh")],
  );
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  try {
    await vi.waitFor(() => expect(existsSync(join(dir, "ready"))).toBe(true));
    await vi.waitFor(
      () => {
        expect(readFileSync(join(dir, "output.log"), "utf8")).toBe(
          "first progress\ndiagnostic\n",
        );
      },
      { timeout: 1500, interval: 25 },
    );
    expect(existsSync(join(dir, "exit.code"))).toBe(false);
    expect(child.exitCode).toBeNull();
  } finally {
    writeFileSync(join(dir, "release"), "");
    const code = await finished;
    try {
      expect(code).toBe(7);
      expect(readFileSync(join(dir, "exit.code"), "utf8")).toBe("7");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
