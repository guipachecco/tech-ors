import { z } from "zod";
import path from "node:path";
import os from "node:os";

export type Config = {
  /** Endereço do banco: `libsql://…` (Turso, na nuvem) ou `file:…` (arquivo local). */
  databaseUrl: string;
  /** Token do banco na nuvem (Turso). Não é usado com arquivo local. */
  databaseAuthToken?: string;
  sessionSecret: string;
  totpEncryptionKey?: string;
  isProduction: boolean;
};

const schema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa ter pelo menos 32 caracteres"),
  DATABASE_URL: z.string().optional(),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  // nomes que a integração Turso/Vercel já preenche sozinha
  TURSO_DATABASE_URL: z.string().optional(),
  TURSO_AUTH_TOKEN: z.string().optional(),
  // forma antiga (caminho de arquivo), ainda aceita
  DATABASE_PATH: z.string().optional(),
  TOTP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "TOTP_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais").optional(),
  LOCALAPPDATA: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

const blank = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = schema.parse(env);
  const base = e.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const databaseUrl =
    blank(e.DATABASE_URL) ??
    blank(e.TURSO_DATABASE_URL) ??
    (blank(e.DATABASE_PATH) ? `file:${blank(e.DATABASE_PATH)}` : `file:${path.join(base, "TechMasterOrcamentos", "orcamentos.db")}`);
  return {
    databaseUrl,
    databaseAuthToken: blank(e.DATABASE_AUTH_TOKEN) ?? blank(e.TURSO_AUTH_TOKEN),
    sessionSecret: e.SESSION_SECRET,
    totpEncryptionKey: e.TOTP_ENCRYPTION_KEY,
    isProduction: e.NODE_ENV === "production",
  };
}
