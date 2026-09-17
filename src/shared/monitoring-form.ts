export const smtpProviders = [
  { value: "qq", label: "QQ 邮箱", host: "smtp.qq.com:587" },
  { value: "163", label: "网易 163", host: "smtp.163.com:465" },
  { value: "126", label: "网易 126", host: "smtp.126.com:465" },
  { value: "custom", label: "自定义 SMTP", host: "" },
];
export const validEmail = (value: string) =>
  /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value);
export const validRecipients = (value: string) =>
  value.split(",").every((v) => validEmail(v.trim()));
export const validSmtpHost = (value: string) => {
  const match = /^([A-Za-z0-9.-]+):(\d+)$/.exec(value);
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 65535;
};
export const validTargetAddress = (value: string) => {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255) &&
    value !== "0.0.0.0" &&
    parts[0] !== "127"
  );
};
export const durationPattern = /^\d+(?:ms|s|m|h|d)$/;
