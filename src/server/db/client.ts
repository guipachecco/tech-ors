import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export function openDatabase(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  db.insert(schema.configuracao).values({ id: 1 }).onConflictDoNothing().run();
  return db;
}

const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  if (!globalForDb.__db) globalForDb.__db = openDatabase(loadConfig().databasePath);
  return globalForDb.__db;
}
