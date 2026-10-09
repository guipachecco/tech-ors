import { loadConfig } from "../../src/infra/config";
import { createDb, isLocalUrl, migrateDb } from "../../src/infra/db/client";

// Aplica as migrações pendentes no banco configurado (DATABASE_URL / TURSO_DATABASE_URL).
// Roda sozinho a cada deploy na Vercel (script vercel-build) e pode ser rodado à mão: npm run db:migrate
async function main() {
  const cfg = loadConfig();
  if (process.env.VERCEL && isLocalUrl(cfg.databaseUrl)) {
    throw new Error(
      "Banco não configurado na Vercel. Em Settings → Environment Variables defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN " +
        "(na Vercel não existe arquivo de banco local) e faça o deploy de novo.",
    );
  }
  await migrateDb(createDb(cfg.databaseUrl, cfg.databaseAuthToken));
  const where = isLocalUrl(cfg.databaseUrl) ? cfg.databaseUrl : new URL(cfg.databaseUrl.replace(/^libsql:/, "https:")).host;
  console.log(`Migrações aplicadas em ${where}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
