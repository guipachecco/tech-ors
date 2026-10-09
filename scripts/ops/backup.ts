import path from "node:path";
import { checkBackup, runBackup } from "../../src/infra/backup";
import { getDb } from "../../src/infra/db/client";

// Uso: npm run backup [-- <pasta-destino>]   (padrão: ./backups, fora do Git)
async function main() {
  const dest = process.argv[2] ?? path.join(process.cwd(), "backups");
  const file = await runBackup(getDb(), dest);
  const check = checkBackup(file);
  if (!check.ok) throw new Error(`Backup criado, mas a verificação falhou: ${check.integrity}`);
  console.log(`Backup OK: ${file} (${check.tables} tabelas)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
