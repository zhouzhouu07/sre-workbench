import { z } from "zod";
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
        z.object({ hostId: z.string().min(1), address: z.ipv4() }).strict(),
      )
      .min(1)
      .max(20),
    retentionDays: z.number().int().min(1).max(365),
    cpuThreshold: z.number().min(1).max(100),
    memoryThreshold: z.number().min(1).max(100),
    diskThreshold: z.number().min(1).max(100),
    duration,
    groupWait: duration,
    groupInterval: duration,
    repeatInterval: duration,
    smtpHost: z
      .string()
      .max(300)
      .refine((s) => !s || /^[A-Za-z0-9.-]+:\d+$/.test(s)),
    smtpFrom: z.string().max(300),
    smtpTo: z.string().max(1000),
    smtpUser: z.string().max(300),
    smtpPassword: z.string().max(10000).optional(),
    smtpCredentialId: z.string().optional(),
    grafanaPassword: z.string().max(10000).optional(),
    grafanaCredentialId: z.string().optional(),
    webhook: z.string().max(3000),
  })
  .strict();
