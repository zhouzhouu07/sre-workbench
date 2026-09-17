import { contextBridge, ipcRenderer } from "electron";
import type { AppEvent, DesktopApi } from "../shared/types";
const api: DesktopApi = {
  call: async (method, params) => {
    const result = await ipcRenderer.invoke("sre:call", method, params);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  subscribe: (callback) => {
    const listener = (_: unknown, event: AppEvent) => callback(event);
    ipcRenderer.on("sre:event", listener);
    return () => ipcRenderer.removeListener("sre:event", listener);
  },
};
contextBridge.exposeInMainWorld("sre", api);
