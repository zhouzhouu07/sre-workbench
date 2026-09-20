import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  session,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Backend } from "./core/backend";
import { AIService } from "./features/ai";
import { AgentService } from "./features/agent";
import { FeatureService } from "./features/operations";
import { errorMessage } from "./core/errors";
import type { AppEvent } from "../shared/types";

if (process.env.SRE_DATA_DIR) app.setPath("userData", process.env.SRE_DATA_DIR);
let window: BrowserWindow | undefined;
let core: Backend | undefined;
let ai: AIService | undefined;
let agent: AgentService | undefined;
let operations: FeatureService | undefined;
let quitting = false;
const emit = (event: AppEvent) => {
  if (window && !window.isDestroyed())
    window.webContents.send("sre:event", event);
};
const start = async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Windows 凭据加密服务不可用，无法安全打开工作台");
  core = new Backend({
    dataDir: app.getPath("userData"),
    encrypt: (s) => safeStorage.encryptString(s).toString("base64"),
    decrypt: (s) => safeStorage.decryptString(Buffer.from(s, "base64")),
    emit,
    chooseFile: async (mode) => {
      if (mode === "save") {
        const result = await dialog.showSaveDialog(window!, {});
        return result.canceled ? null : (result.filePath ?? null);
      }
      const result = await dialog.showOpenDialog(window!, {
        properties: mode === "directory" ? ["openDirectory"] : ["openFile"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  await core.init();
  ai = new AIService(core.store, emit);
  agent = new AgentService(core, ai, emit);
  operations = new FeatureService(core, {
    gitPath: app.isPackaged
      ? join(process.resourcesPath, "git", "cmd", "git.exe")
      : join(app.getAppPath(), "vendor", "git", "cmd", "git.exe"),
    tempDir: join(app.getPath("userData"), "staging"),
    openExternal: async (url: string) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1")
        throw new Error("仅允许打开本地 SSH 隧道");
      await shell.openExternal(url);
    },
  });
  const renderer = join(__dirname, "../renderer/index.html");
  const trusted = pathToFileURL(renderer).href;
  ipcMain.handle("sre:call", async (event, method, params) => {
    try {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== trusted
      )
        throw new Error("IPC 来源无效");
      if (typeof method !== "string" || method.length > 80)
        throw new Error("操作名无效");
      if (JSON.stringify(params ?? {}).length > 2_000_000)
        throw new Error("请求过大");
      const value = method.startsWith("ai.session.")
        ? await agent!.handle(method, params)
        : method.startsWith("ai.") || method.startsWith("provider.")
          ? await ai!.handle(method, params)
          : method.startsWith("deployment.") || method.startsWith("monitoring.")
            ? await operations!.handle(method, params)
            : await core!.handle(method, params ?? {});
      return { ok: true, value };
    } catch (e) {
      return {
        ok: false,
        error: core?.store.redact(errorMessage(e)) ?? "请求失败",
      };
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_web, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
    show: false,
    backgroundColor: "#f3f6f9",
    icon: join(__dirname, "icon.png"),
    title: "SRE 运维工作台",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  await window.loadFile(renderer);
  window.show();
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
};
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    await agent?.close();
    ai?.close();
    await operations?.close();
    await core?.close();
    app.quit();
  })().catch(() => app.exit(1));
});
void start().catch((error) => {
  dialog.showErrorBox("SRE 工作台启动失败", String(error));
  app.exit(1);
});
