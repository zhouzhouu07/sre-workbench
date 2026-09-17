import { z } from "zod";
import {
  validEmail,
  validRecipients,
  validSmtpHost,
  validTargetAddress,
} from "../../shared/monitoring-form";
export const identifier = z.string().uuid();
export const idParams = z.object({ id: identifier }).strict();
const duration = z.string().regex(/^\d+(?:ms|s|m|h|d)$/);
const absolute = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (s) =>
      s.startsWith("/") &&
      !/[\x00-\x1f]/.test(s) &&
      !s.split("/").includes(".."),
    "需要无上级跳转的绝对路径",
  );
const text = z.string().max(2000);
export const deploySchema = z
  .object({
    id: identifier.optional(),
    hostId: z.string().min(1),
    name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    sourceType: z.enum(["local", "git"]),
    source: z.string().min(1).max(4096),
    gitRef: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/)
      .default("main"),
    gitToken: z.string().max(20000).optional(),
    gitCredentialId: z.string().optional(),
    template: z.enum(["static", "node", "python", "dockerfile"]),
    runtime: z.string().max(50).default("22.14.0"),
    installCommand: text.default(""),
    buildCommand: text.default(""),
    startCommand: text.default(""),
    outputDir: z
      .string()
      .regex(/^[a-zA-Z0-9_.][a-zA-Z0-9_./-]*$/)
      .refine((s) => !s.split("/").includes(".."))
      .default("dist"),
    containerPort: z.number().int().min(1).max(65535),
    publicPort: z.number().int().min(1).max(65535),
    domain: z
      .string()
      .max(253)
      .refine(
        (s) =>
          s === "" ||
          /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(
            s,
          ),
      )
      .default(""),
    healthPath: z
      .string()
      .regex(/^\/[a-zA-Z0-9_./?=&%+-]*$/)
      .max(2000)
      .default("/"),
    env: z
      .record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        z.string().max(10000),
      )
      .default({}),
    volumes: z
      .array(z.object({ source: absolute, target: absolute }).strict())
      .max(20)
      .default([]),
  })
  .strict();
export const monitorSchema = z
  .object({
    id: identifier.optional(),
    hostId: z.string().min(1),
    name: z.string().min(1).max(100),
    targets: z
      .array(
        z
          .object({
            hostId: z.string().min(1, "请选择采集主机"),
            address: z
              .string()
              .refine(validTargetAddress, "请输入主机间可达的 IPv4 地址"),
          })
          .strict(),
      )
      .min(1, "请至少添加一台采集主机")
      .max(20),
    retentionDays: z.number().int().min(1).max(365),
    cpuThreshold: z.number().min(1).max(100),
    memoryThreshold: z.number().min(1).max(100),
    diskThreshold: z.number().min(1).max(100),
    duration,
    groupWait: duration,
    groupInterval: duration,
    repeatInterval: duration,
    smtpEnabled: z.boolean().optional(),
    smtpHost: z
      .string()
      .max(300)
      .refine(
        (s) => !s || validSmtpHost(s),
        "请输入 SMTP 主机:端口，端口范围 1–65535",
      ),
    smtpFrom: z.string().max(300),
    smtpTo: z.string().max(1000),
    smtpUser: z.string().max(300),
    smtpPassword: z.string().max(10000).optional(),
    smtpCredentialId: z.string().optional(),
    grafanaPassword: z.string().max(10000).optional(),
    grafanaCredentialId: z.string().optional(),
    webhook: z.string().max(3000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.smtpEnabled ?? !!value.smtpHost) {
      if (!value.smtpHost)
        ctx.addIssue({
          code: "custom",
          path: ["smtpHost"],
          message: "请输入 SMTP 主机:端口",
        });
      if (!validEmail(value.smtpFrom))
        ctx.addIssue({
          code: "custom",
          path: ["smtpFrom"],
          message: "请输入有效的发件邮箱",
        });
      if (!validRecipients(value.smtpTo))
        ctx.addIssue({
          code: "custom",
          path: ["smtpTo"],
          message: "请输入有效的收件邮箱，多个邮箱用英文逗号分隔",
        });
    }
    const hosts = new Set<string>();
    value.targets.forEach((target, index) => {
      if (hosts.has(target.hostId))
        ctx.addIssue({
          code: "custom",
          path: ["targets", index, "hostId"],
          message: "同一主机不能重复添加",
        });
      hosts.add(target.hostId);
    });
  });
