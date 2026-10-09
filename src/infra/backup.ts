import { createClient, type InValue } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db/client";

const PREFIX = "orcamentos-";
const DAY = 86_400_000;
const BATCH = 300;

function stamp(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

function literal(v: InValue | ArrayBuffer): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (v instanceof ArrayBuffer) return `X'${Buffer.from(v).toString("hex")}'`;
  if (ArrayBuffer.isView(v)) return `X'${Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("hex")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Exporta o banco inteiro (estrutura + dados) para um arquivo .sql. Funciona com qualquer banco
 * (arquivo ou nuvem) e é lido por `restoreDump`, pelo shell do Turso e pelo sqlite3.
 */
export async function dumpSql(db: Db, file: string): Promise<{ tables: number; rows: number }> {
  const c = db.$client;
  const objects = (await c.execute("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid")).rows;
  const tables = objects.filter((o) => o.type === "table");
  const out = fs.createWriteStream(file, { encoding: "utf8" });
  const write = (s: string) => new Promise<void>((res, rej) => out.write(s, (e) => (e ? rej(e) : res())));
  let rowCount = 0;
  try {
    await write("-- Backup do sistema de orçamentos (SQL). Restaurar: npm run restore -- arquivo.sql\nPRAGMA foreign_keys=OFF;\nBEGIN;\n");
    for (const t of tables) await write(`${String(t.sql)};\n`);
    for (const t of tables) {
      const name = String(t.name);
      for (let offset = 0; ; offset += BATCH) {
        const rs = await c.execute({ sql: `SELECT * FROM ${ident(name)} ORDER BY rowid LIMIT ${BATCH} OFFSET ${offset}`, args: [] });
        if (rs.rows.length === 0) break;
        const cols = rs.columns.map(ident).join(", ");
        let chunk = "";
        for (const row of rs.rows) {
          const values = rs.columns.map((_, i) => literal(row[i] as InValue | ArrayBuffer)).join(", ");
          chunk += `INSERT INTO ${ident(name)} (${cols}) VALUES (${values});\n`;
          rowCount++;
        }
        await write(chunk);
      }
    }
    for (const o of objects.filter((x) => x.type !== "table")) await write(`${String(o.sql)};\n`);
    await write("COMMIT;\nPRAGMA foreign_keys=ON;\n");
  } finally {
    await new Promise<void>((res) => out.end(() => res()));
  }
  return { tables: tables.length, rows: rowCount };
}

/** Restaura um arquivo gerado por `dumpSql` num banco VAZIO (recusa se já houver tabelas). */
export async function restoreDump(db: Db, file: string): Promise<void> {
  const existing = (await db.$client.execute("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows[0].n;
  if (Number(existing) > 0) throw new Error("O banco de destino não está vazio. Restaure num banco novo.");
  await db.$client.executeMultiple(fs.readFileSync(file, "utf8"));
}

/**
 * Backup + remoção de cópias antigas. Banco em arquivo: cópia exata (.db). Banco na nuvem: exportação SQL (.sql).
 * Com `format: "sql"` força a exportação SQL também para banco em arquivo (ex.: levar os dados do computador para o Turso).
 */
export async function runBackup(db: Db, destDir: string, now = new Date(), keepDays = 30, format: "auto" | "sql" = "auto"): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });
  const local = db.$client.protocol === "file" && format === "auto";
  const dest = path.join(destDir, `${PREFIX}${stamp(now)}.${local ? "db" : "sql"}`);
  if (fs.existsSync(dest)) fs.rmSync(dest);
  if (local) await db.$client.execute(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  else await dumpSql(db, dest);

  for (const name of fs.readdirSync(destDir)) {
    const m = /^orcamentos-(\d{4}-\d{2}-\d{2})\.(db|sql)$/.exec(name);
    if (!m) continue;
    const age = now.getTime() - new Date(`${m[1]}T12:00:00-03:00`).getTime();
    if (age > keepDays * DAY) fs.rmSync(path.join(destDir, name));
  }
  return dest;
}

/** Confere um backup: .db é aberto e verificado; .sql é restaurado numa cópia em memória e contado. */
export async function checkBackup(file: string): Promise<{ ok: boolean; tables: number; integrity: string }> {
  const client = createClient({ url: file.endsWith(".sql") ? ":memory:" : `file:${file}` });
  try {
    if (file.endsWith(".sql")) await client.executeMultiple(fs.readFileSync(file, "utf8"));
    const integrity = String((await client.execute("PRAGMA integrity_check")).rows[0][0]);
    const tables = Number((await client.execute("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows[0].n);
    return { ok: integrity === "ok" && tables > 0, tables, integrity };
  } finally {
    client.close();
  }
}
