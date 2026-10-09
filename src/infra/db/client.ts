import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema> & { $client: Client };
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Banco local (arquivo ou memória): migra sozinho ao iniciar. Banco na nuvem: migra no deploy (npm run db:migrate). */
export const isLocalUrl = (url: string) => url === ":memory:" || url.startsWith("file:");

/** Cria o acesso ao banco (não abre conexão até o primeiro uso). */
export function createDb(url: string, authToken?: string): Db {
  if (url.startsWith("file:")) {
    const file = url.slice("file:".length);
    if (file && !file.startsWith(":")) fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  return drizzle(createClient({ url, authToken }), { schema }) as Db;
}

/** Aplica as migrações pendentes e garante a linha única de configurações. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await db.insert(schema.configuracao).values({ id: 1 }).onConflictDoNothing().run();
}

/** Cria + migra: usado por testes, scripts e comandos de servidor. */
export async function openDatabase(url: string, authToken?: string): Promise<Db> {
  const db = createDb(url, authToken);
  await migrateDb(db);
  return db;
}

const g = globalThis as unknown as { __db?: Db; __migrated?: Promise<void> };

/** Banco da aplicação (um por processo). Síncrono: a conexão só abre na primeira consulta. */
export function getDb(): Db {
  if (!g.__db) {
    const cfg = loadConfig();
    g.__db = createDb(cfg.databaseUrl, cfg.databaseAuthToken);
  }
  return g.__db;
}

/** Chamado ao iniciar o servidor: migra apenas banco local (arquivo). Na nuvem, a migração roda no deploy. */
export function ensureMigrated(): Promise<void> {
  if (!g.__migrated) {
    const cfg = loadConfig();
    g.__migrated = isLocalUrl(cfg.databaseUrl) ? migrateDb(getDb()) : Promise.resolve();
  }
  return g.__migrated;
}
