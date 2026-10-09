import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db/client";

const PREFIX = "orcamentos-";
const DAY = 86_400_000;

function stamp(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** Cópia consistente do banco (API de backup do SQLite) + remoção de cópias antigas. */
export async function runBackup(db: Db, destDir: string, now = new Date(), keepDays = 30): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${PREFIX}${stamp(now)}.db`);
  await (db as unknown as { $client: Database.Database }).$client.backup(dest);

  // A cópia herda o modo WAL; converte para um arquivo único e autocontido (sem -wal/-shm ao lado).
  const copy = new Database(dest);
  copy.pragma("journal_mode = DELETE");
  copy.close();

  for (const name of fs.readdirSync(destDir)) {
    const m = /^orcamentos-(\d{4}-\d{2}-\d{2})\.db$/.exec(name);
    if (!m) continue;
    const age = now.getTime() - new Date(`${m[1]}T12:00:00-03:00`).getTime();
    if (age > keepDays * DAY) fs.rmSync(path.join(destDir, name));
  }
  return dest;
}

export function checkBackup(file: string): { ok: boolean; tables: number; integrity: string } {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(sqlite.pragma("integrity_check", { simple: true }));
    const tables = (sqlite.prepare("select count(*) as n from sqlite_master where type='table'").get() as { n: number }).n;
    return { ok: integrity === "ok" && tables > 0, tables, integrity };
  } finally {
    sqlite.close();
  }
}
