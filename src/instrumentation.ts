// Executa uma vez quando o servidor inicia. Banco local: aplica migrações pendentes.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureMigrated } = await import("@/infra/db/client");
    await ensureMigrated();
  }
}
