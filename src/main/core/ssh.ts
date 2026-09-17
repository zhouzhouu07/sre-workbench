import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import { createHash, randomUUID } from "node:crypto";
import type { AppEvent, FileEntry, Host } from "../../shared/types";
import { Store } from "./store";
import { shellQuote } from "./safety";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}
export interface ExecOptions {
  sudo?: boolean;
  timeout?: number;
  input?: string;
  /** Internal parser only: never expose raw output through IPC. */ raw?: boolean;
}
export class SSHManager {
  private terminals = new Map<
    string,
    { client: Client; channel: ClientChannel; hostId: string }
  >();
  private connections = new Set<Client>();
  constructor(
    private store: Store,
    private emit: (event: AppEvent) => void,
  ) {}
  host(id: string): Host {
    const host = this.store.get<Host>("hosts", id);
    if (!host) throw new Error("主机不存在");
    return host;
  }
  private credential(host: Host): Record<string, string> {
    return JSON.parse(this.store.getSecret(host.credentialId) || "{}");
  }
  async probe(id: string): Promise<string> {
    const host = this.host(id);
    return new Promise((resolve, reject) => {
      const client = new Client();
      let fingerprint = "";
      client.on("error", () => {
        client.end();
        fingerprint
          ? resolve(fingerprint)
          : reject(new Error("无法获取 SSH 主机指纹，请检查地址及端口"));
      });
      client.connect({
        host: host.address,
        port: host.port,
        username: host.username,
        readyTimeout: 15000,
        hostVerifier: (key: Buffer) => {
          fingerprint =
            "SHA256:" +
            createHash("sha256")
              .update(key)
              .digest("base64")
              .replace(/=+$/, "");
          return false;
        },
      });
    });
  }
  async connect(id: string): Promise<Client> {
    const host = this.host(id);
    if (!host.fingerprint) throw new Error("请先核验并信任 SSH 主机指纹");
    const credential = this.credential(host);
    return new Promise((resolve, reject) => {
      const client = new Client();
      this.connections.add(client);
      let changed = false,
        ready = false;
      client.once("ready", () => {
        ready = true;
        resolve(client);
      });
      client.on("error", (error) => {
        reject(
          new Error(
            changed
              ? "SSH 主机密钥发生变化，连接已拒绝"
              : this.store.redact(error.message),
          ),
        );
        client.end();
      });
      client.once("close", () => {
        this.connections.delete(client);
        if (!ready) reject(new Error("SSH 连接在认证完成前关闭"));
      });
      client.connect({
        host: host.address,
        port: host.port,
        username: host.username,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        ...(host.authType === "key"
          ? {
              privateKey: credential.privateKey,
              passphrase: credential.passphrase,
            }
          : { password: credential.password }),
        hostVerifier: (key: Buffer) => {
          const fp =
            "SHA256:" +
            createHash("sha256")
              .update(key)
              .digest("base64")
              .replace(/=+$/, "");
          changed = fp !== host.fingerprint;
          return !changed;
        },
      });
    });
  }
  async exec(
    id: string,
    command: string,
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const client = await this.connect(id);
    const host = this.host(id),
      credential = this.credential(host);
    const useSudo = options.sudo && host.username !== "root";
    if (useSudo && options.input) {
      client.end();
      throw new Error("sudo 命令不支持混合标准输入");
    }
    const wrapped = useSudo
      ? `sudo ${credential.sudoPassword ? "-S" : "-n"} -p '' -- /bin/sh -c ${shellQuote(command)}`
      : command;
    return new Promise((resolve, reject) => {
      let done = false,
        stdout = "",
        stderr = "";
      const finish = (error?: Error, code = 0) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        client.end();
        if (error) reject(error);
        else
          resolve({
            stdout: options.raw ? stdout : this.store.redact(stdout),
            stderr: this.store.redact(stderr),
            code,
          });
      };
      const timer = setTimeout(
        () => finish(new Error("SSH 命令超时，远程状态需核验")),
        Math.min(options.timeout || 30000, 3600000),
      );
      client.once("close", () => finish(new Error("SSH 连接已中断")));
      client.exec(wrapped, (error, channel) => {
        if (error) return finish(error);
        const collect = (chunk: Buffer, isError = false) => {
          if (isError) stderr += chunk.toString();
          else stdout += chunk.toString();
          if (stdout.length + stderr.length > 2_000_000) {
            channel.close();
            finish(new Error("命令输出超过 2MB 限制"));
          }
        };
        channel.setEncoding("utf8");
        channel.stderr.setEncoding("utf8");
        channel.on("data", (c: Buffer) => collect(c));
        channel.stderr.on("data", (c: Buffer) => collect(c, true));
        channel.once("error", (e: Error) => finish(e));
        channel.once("close", (code: number) => finish(undefined, code ?? 255));
        if (useSudo && credential.sudoPassword)
          channel.end(credential.sudoPassword + "\n");
        else if (options.input !== undefined) channel.end(options.input);
      });
    });
  }
  private async sftp<T>(
    id: string,
    work: (s: SFTPWrapper) => Promise<T>,
  ): Promise<T> {
    const client = await this.connect(id);
    try {
      const s = await new Promise<SFTPWrapper>((resolve, reject) =>
        client.sftp((e, s) => (e ? reject(e) : resolve(s))),
      );
      return await work(s);
    } finally {
      client.end();
    }
  }
  async list(id: string, path: string): Promise<FileEntry[]> {
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) =>
          s.readdir(path, (e, items) =>
            e
              ? reject(e)
              : resolve(
                  items.map((item) => ({
                    name: item.filename,
                    path: path.replace(/\/$/, "") + "/" + item.filename,
                    size: item.attrs.size,
                    directory: item.attrs.isDirectory(),
                    modified: item.attrs.mtime * 1000,
                  })),
                ),
          ),
        ),
    );
  }
  async read(id: string, path: string): Promise<string> {
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) => {
          const stream = s.createReadStream(path);
          stream.setEncoding("utf8");
          let result = "";
          stream.on("data", (chunk: Buffer) => {
            result += chunk.toString();
            if (result.length > 1_000_000) {
              stream.destroy();
              reject(new Error("文件超过 1MB 在线编辑限制"));
            }
          });
          stream.once("end", () => resolve(result));
          stream.once("error", reject);
        }),
    );
  }
  async write(id: string, path: string, content: string): Promise<void> {
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) => {
          const stream = s.createWriteStream(path, { mode: 0o600 });
          stream.once("error", reject);
          stream.once("close", () => resolve());
          stream.end(content);
        }),
    );
  }
  async mkdir(id: string, path: string): Promise<void> {
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) =>
          s.mkdir(path, (e) => (e ? reject(e) : resolve())),
        ),
    );
  }
  async rename(id: string, path: string, destination: string): Promise<void> {
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) =>
          s.rename(path, destination, (e) => (e ? reject(e) : resolve())),
        ),
    );
  }
  async remove(id: string, path: string): Promise<void> {
    if (path === "/") throw new Error("禁止删除根目录");
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) =>
          s.lstat(path, (e, attrs) => {
            if (e) return reject(e);
            const done = (error?: Error | null) =>
              error ? reject(error) : resolve();
            if (attrs.isDirectory()) s.rmdir(path, done);
            else s.unlink(path, done);
          }),
        ),
    );
  }
  async upload(
    id: string,
    localPath: string,
    remotePath: string,
  ): Promise<void> {
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) =>
          s.fastPut(localPath, remotePath, (e) => (e ? reject(e) : resolve())),
        ),
    );
  }
  async download(
    id: string,
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    return this.sftp(
      id,
      (s) =>
        new Promise((resolve, reject) =>
          s.fastGet(remotePath, localPath, (e) => (e ? reject(e) : resolve())),
        ),
    );
  }
  async openTerminal(
    hostId: string,
    cols = 100,
    rows = 30,
  ): Promise<{ id: string }> {
    const client = await this.connect(hostId);
    return new Promise((resolve, reject) =>
      client.shell({ term: "xterm-256color", cols, rows }, (error, channel) => {
        if (error) {
          client.end();
          return reject(error);
        }
        const id = randomUUID();
        this.terminals.set(id, { client, channel, hostId });
        channel.setEncoding("utf8");
        channel.stderr.setEncoding("utf8");
        channel.on("data", (chunk: string) =>
          this.emit({ type: "terminal", id, data: chunk }),
        );
        channel.stderr.on("data", (chunk: string) =>
          this.emit({ type: "terminal", id, data: chunk }),
        );
        channel.once("close", () => {
          this.terminals.delete(id);
          client.end();
          this.emit({ type: "terminal", id, data: "\r\n[连接已关闭]\r\n" });
        });
        resolve({ id });
      }),
    );
  }
  terminalWrite(id: string, data: string): void {
    const t = this.terminals.get(id);
    if (!t) throw new Error("终端已关闭");
    t.channel.write(data);
  }
  terminalResize(id: string, cols: number, rows: number): void {
    this.terminals.get(id)?.channel.setWindow(rows, cols, 0, 0);
  }
  terminalClose(id: string): void {
    this.terminals.get(id)?.client.end();
    this.terminals.delete(id);
  }
  closeHost(hostId: string): void {
    for (const [id, t] of this.terminals)
      if (t.hostId === hostId) this.terminalClose(id);
  }
  close(): void {
    for (const client of this.connections) client.end();
    this.terminals.clear();
  }
}
