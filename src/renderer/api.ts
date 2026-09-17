import { message } from "antd";
export async function call<T = any>(
  method: string,
  params?: unknown,
): Promise<T> {
  if (!window.sre) throw new Error("请在桌面软件中使用此功能");
  return window.sre.call<T>(method, params);
}
export const reportError = (error: unknown) => {
  void message.error(error instanceof Error ? error.message : String(error), 6);
};
