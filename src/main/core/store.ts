import initSqlJs, { type Database } from "sql.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "../../shared/types";

const COLLECTIONS = [
  "hosts",
  "tasks",
  "scripts",
  "deployments",
  "releases",
  "monitoring",
  "providers",
];
export class Store {
  private db!: Database;
  private file: string;
  constructor(
    dataDir: string,
    private encrypt: (s: string) => string,
    private decrypt: (s: string) => string,
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "sre.sqlite");
  }
  async init(): Promise<void> {
    const packaged =
      typeof __dirname === "string" ? join(__dirname, "sql-wasm.wasm") : "";
    const SQL = await initSqlJs({
      locateFile: () =>
        existsSync(packaged)
          ? packaged
          : join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
    });
    this.db = new SQL.Database(
      existsSync(this.file) ? readFileSync(this.file) : undefined,
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(collection,id)); CREATE TABLE IF NOT EXISTS secrets(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    this.persist();
  }
  private collection(name: string): void {
    if (!COLLECTIONS.includes(name)) throw new Error("Unsupported collection");
  }
  list<T = any>(collection: string): T[] {
    this.collection(collection);
    const s = this.db.prepare(
      "SELECT data FROM records WHERE collection=? ORDER BY rowid",
    );
    try {
      s.bind([collection]);
      const result: T[] = [];
      while (s.step()) result.push(JSON.parse(s.getAsObject().data as string));
      return result;
    } finally {
      s.free();
    }
  }
  get<T = any>(collection: string, id: string): T | undefined {
    return this.list<T & { id: string }>(collection).find((x) => x.id === id);
  }
  put<T extends { id: string }>(collection: string, value: T): void {
    this.collection(collection);
    this.db.run(
      "INSERT OR REPLACE INTO records(collection,id,data) VALUES(?,?,?)",
      [collection, value.id, JSON.stringify(value)],
    );
    this.persist();
  }
  remove(collection: string, id: string): void {
    this.collection(collection);
    this.db.run("DELETE FROM records WHERE collection=? AND id=?", [
      collection,
      id,
    ]);
    this.persist();
  }
  setSecret(value: string, id: string = randomUUID()): string {
    this.db.run("INSERT OR REPLACE INTO secrets(id,value) VALUES(?,?)", [
      id,
      this.encrypt(value),
    ]);
    this.persist();
    return id;
  }
  getSecret(id: string): string | undefined {
    const s = this.db.prepare("SELECT value FROM secrets WHERE id=?");
    try {
      s.bind([id]);
      return s.step()
        ? this.decrypt(s.getAsObject().value as string)
        : undefined;
    } finally {
      s.free();
    }
  }
  deleteSecret(id: string): void {
    this.db.run("DELETE FROM secrets WHERE id=?", [id]);
    this.persist();
  }
  redact(text: string): string {
    const rows = this.db.exec("SELECT value FROM secrets");
    const secrets = new Set<string>();
    for (const row of rows[0]?.values || []) {
      let value: string;
      try {
        value = this.decrypt(row[0] as string);
      } catch {
        continue;
      }
      const values = [value];
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object")
          values.push(
            ...Object.values(parsed).filter(
              (v): v is string => typeof v === "string",
            ),
          );
      } catch {}
      for (const secret of values) if (secret.length > 0) secrets.add(secret);
    }
    const expression = [...secrets]
      .sort((a, b) => b.length - a.length)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const result = expression
      ? text.replace(new RegExp(expression, "g"), "[REDACTED]")
      : text;
    return result.replace(
      /(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s]+/gi,
      "$1[REDACTED]",
    );
  }
  snapshot(): Snapshot {
    const snapshot = Object.fromEntries(
      COLLECTIONS.map((c) => [c, this.list(c)]),
    ) as unknown as Snapshot;
    snapshot.tasks = snapshot.tasks.map((task) => {
      const { spec, directory, cancelRequested, system, submitted, ...safe } =
        task as any;
      return safe;
    });
    return snapshot;
  }
  private persist(): void {
    const temp = this.file + ".tmp";
    writeFileSync(temp, this.db.export(), { mode: 0o600 });
    const fd = openSync(temp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.file);
  }
  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
    }
  }
}
