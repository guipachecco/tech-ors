import path from "node:path";
import { checkBackup, runBackup } from "../../src/infra/backup";
import { ensureMigrated, getDb } from "../../src/infra/db/client";

// Uso: npm run backup [-- [--sql] <pasta-destino>]   (padrão: ./backups, fora do Git)
// Banco em arquivo → cópia .db; banco na nuvem (Turso) → exportação .sql. Com --sql, sempre .sql.
async function main() {
  const args = process.argv.slice(2);
  const dest = args.find((a) => !a.startsWith("--")) ?? path.join(process.cwd(), "backups");
  await ensureMigrated();
  const file = await runBackup(getDb(), dest, new Date(), 30, args.includes("--sql") ? "sql" : "auto");
  const check = await checkBackup(file);
  if (!check.ok) throw new Error(`Backup criado, mas a verificação falhou: ${check.integrity}`);
  console.log(`Backup OK: ${file} (${check.tables} tabelas)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
