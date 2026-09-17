import { ZodError } from "zod";

const labels: Record<string, string> = {
  name: "名称",
  hostId: "目标主机",
  targets: "采集主机",
  address: "主机地址",
  timeout: "超时",
  port: "端口",
  smtpHost: "SMTP 地址",
  smtpFrom: "发件邮箱",
  smtpTo: "收件邮箱",
  smtpUser: "SMTP 用户",
  grafanaPassword: "Grafana 密码",
  baseUrl: "API 地址",
  model: "模型名称",
  script: "脚本内容",
  body: "脚本内容",
};
export function errorMessage(error: unknown): string {
  if (!(error instanceof ZodError))
    return error instanceof Error ? error.message : String(error);
  return [
    ...new Set(
      error.issues.slice(0, 4).map((issue) => {
        const field = issue.path
          .filter((p) => typeof p === "string")
          .map((p) => labels[String(p)] ?? "配置项")
          .join(" / ");
        const detail = /[\u4e00-\u9fff]/.test(issue.message)
          ? issue.message
          : "请检查填写内容、格式及允许范围";
        return `${field || "请求参数"}：${detail}`;
      }),
    ),
  ].join("；");
}
