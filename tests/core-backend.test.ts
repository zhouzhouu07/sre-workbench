import { it, expect, afterEach } from "vitest";
import { Backend } from "../src/main/core/backend";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
async function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "sre-rpc-"));
  dirs.push(dataDir);
  const b = new Backend({
    dataDir,
    encrypt: (s) => Buffer.from(s).toString("base64"),
    decrypt: (s) => Buffer.from(s, "base64").toString(),
    emit: () => {},
    chooseFile: async () => null,
  });
  await b.init();
  return b;
}
it("rejects unknown fields and requires actual credentials; preserves secrets on edit", async () => {
  const b = await setup();
  try {
    await expect(
      b.handle("host.save", {
        name: "h",
        address: "127.0.0.1",
        port: 22,
        username: "u",
        authType: "password",
        group: "",
        tags: [],
      }),
    ).rejects.toThrow();
    const host = await b.handle("host.save", {
      name: "h",
      address: "127.0.0.1",
      port: 22,
      username: "u",
      authType: "password",
      password: "secret-pass",
      group: "",
      tags: [],
    });
    expect(JSON.stringify(host)).not.toContain("secret-pass");
    const edited = await b.handle("host.save", {
      id: host.id,
      name: "new",
      address: "127.0.0.1",
      port: 22,
      username: "u",
      authType: "password",
      group: "",
      tags: [],
    });
    expect(edited.credentialId).toBe(host.credentialId);
    await expect(
      b.handle("host.trust", { id: host.id, fingerprint: "SHA256:fake" }),
    ).rejects.toThrow();
    await expect(
      b.handle("inspect", { hostId: host.id, kind: "services", evil: true }),
    ).rejects.toThrow();
    await expect(
      b.handle("execution.preview", {
        hostId: host.id,
        title: "x",
        script: "echo x",
        sudo: false,
        timeout: 0,
      }),
    ).rejects.toThrow();
    await expect(
      b.handle("file.remove", { hostId: host.id, path: "/" }),
    ).rejects.toThrow();
  } finally {
    await b.close();
  }
});
it("restart marks running and queued jobs unknown without resubmitting", async () => {
  const b = await setup();
  b.store.put("tasks", {
    id: "a",
    hostId: "h",
    status: "running",
    title: "t",
    logs: "",
    createdAt: "x",
    updatedAt: "x",
  });
  b.store.put("tasks", {
    id: "b",
    hostId: "h",
    status: "queued",
    title: "t",
    logs: "",
    createdAt: "x",
    updatedAt: "x",
  });
  await b.close();
  const dataDir = dirs[0];
  const c = new Backend({
    dataDir,
    encrypt: (s) => s,
    decrypt: (s) => s,
    emit: () => {},
    chooseFile: async () => null,
  });
  await c.init();
  expect(c.store.list<any>("tasks").map((x) => x.status)).toEqual([
    "unknown",
    "unknown",
  ]);
  await c.close();
});
it("reports invalid input as a readable field error without schema internals", async () => {
  const b = await setup();
  try {
    await expect(
      b.handle("execution.preview", {
        hostId: "h",
        title: "test",
        script: "true",
        sudo: false,
        timeout: 0,
      }),
    ).rejects.toThrow(/^超时.*填写/);
  } finally {
    await b.close();
  }
});
