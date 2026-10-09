// Emergência: zera o 2FA de um usuário pelo servidor (ex.: todos os administradores perderam o celular
// ou o .env com a TOTP_ENCRYPTION_KEY foi perdido). No próximo login a pessoa configura um novo autenticador.
// Uso: npm run reset-2fa -- email@empresa.com
import { eq } from "drizzle-orm";
import { recordAudit } from "../../src/infra/audit";
import { ensureMigrated, getDb } from "../../src/infra/db/client";
import { codigosRecuperacao, mfaPendentes, sessoes, usuarios } from "../../src/infra/db/schema";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Uso: npm run reset-2fa -- email@empresa.com");

  await ensureMigrated();
  const db = getDb();
  const user = await db.select().from(usuarios).where(eq(usuarios.email, email)).get();
  if (!user) throw new Error(`Usuário não encontrado: ${email}`);

  await db.transaction(async (tx) => {
    await tx.update(usuarios).set({ totpSegredoCifrado: null, totpAtivo: false, totpUltimoPasso: null }).where(eq(usuarios.id, user.id)).run();
    await tx.delete(codigosRecuperacao).where(eq(codigosRecuperacao.usuarioId, user.id)).run();
    await tx.delete(mfaPendentes).where(eq(mfaPendentes.usuarioId, user.id)).run();
    await tx.delete(sessoes).where(eq(sessoes.usuarioId, user.id)).run();
  });
  await recordAudit(db, { userId: null, acao: "2fa.redefinir_servidor", entidade: "usuario", entidadeId: user.id });
  console.log(`2FA de ${email} redefinido. No próximo login será pedido para configurar o autenticador.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
