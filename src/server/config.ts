import { z } from "zod";
import path from "node:path";
import os from "node:os";

export type Config = { databasePath: string; sessionSecret: string; totpEncryptionKey?: string; isProduction: boolean };

const schema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa ter pelo menos 32 caracteres"),
  DATABASE_PATH: z.string().optional(),
  TOTP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "TOTP_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais").optional(),
  LOCALAPPDATA: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = schema.parse(env);
  const base = e.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const databasePath = e.DATABASE_PATH?.trim() || path.join(base, "TechMasterOrcamentos", "orcamentos.db");
  return { databasePath, sessionSecret: e.SESSION_SECRET, totpEncryptionKey: e.TOTP_ENCRYPTION_KEY, isProduction: e.NODE_ENV === "production" };
}
