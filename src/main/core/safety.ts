import { createHash, randomBytes } from "node:crypto";
import type { ExecutionSpec } from "../../shared/types";

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}
export function digest(spec: ExecutionSpec, identity: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity,
        spec.hostId,
        spec.title,
        spec.script,
        spec.sudo,
        spec.timeout,
      ]),
    )
    .digest("hex");
}
export class ApprovalBook {
  private entries = new Map<string, { digest: string; expires: number }>();
  issue(spec: ExecutionSpec, identity: string): string {
    for (const [key, value] of this.entries)
      if (value.expires < Date.now()) this.entries.delete(key);
    if (this.entries.size > 1000) throw new Error("待确认操作过多");
    const token = randomBytes(32).toString("hex");
    this.entries.set(token, {
      digest: digest(spec, identity),
      expires: Date.now() + 600_000,
    });
    return token;
  }
  consume(token: string, spec: ExecutionSpec, identity: string): void {
    const approval = this.entries.get(token);
    this.entries.delete(token);
    if (
      !approval ||
      approval.expires < Date.now() ||
      approval.digest !== digest(spec, identity)
    )
      throw new Error("操作确认已过期或内容已改变，请重新预览");
  }
}
export class HostScheduler {
  private active = new Set<string>();
  private queue: { host: string; run: () => Promise<void> }[] = [];
  constructor(private limit = 3) {}
  schedule<T>(host: string, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        host,
        run: async () => {
          try {
            resolve(await job());
          } catch (e) {
            reject(e);
          }
        },
      });
      this.drain();
    });
  }
  private drain(): void {
    while (this.active.size < this.limit) {
      const index = this.queue.findIndex((x) => !this.active.has(x.host));
      if (index < 0) return;
      const [item] = this.queue.splice(index, 1);
      this.active.add(item.host);
      void item.run().finally(() => {
        this.active.delete(item.host);
        this.drain();
      });
    }
  }
}
