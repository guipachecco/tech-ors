import { restoreDump } from "../../src/infra/backup";
import { getDb } from "../../src/infra/db/client";

// Uso: npm run restore -- arquivo.sql
// Restaura um backup .sql no banco configurado (DATABASE_URL). O banco precisa estar VAZIO (recém-criado, sem migrações).
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Uso: npm run restore -- arquivo.sql");
  await restoreDump(getDb(), file);
  console.log(`Backup restaurado a partir de ${file}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
