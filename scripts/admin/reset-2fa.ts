// Emergência: zera o 2FA de um usuário pelo servidor (ex.: todos os administradores perderam o celular
// ou o .env com a TOTP_ENCRYPTION_KEY foi perdido). No próximo login a pessoa configura um novo autenticador.
// Uso: npm run reset-2fa -- email@empresa.com
import { eq } from "drizzle-orm";
import { recordAudit } from "../../src/infra/audit";
import { getDb } from "../../src/infra/db/client";
import { codigosRecuperacao, mfaPendentes, sessoes, usuarios } from "../../src/infra/db/schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Uso: npm run reset-2fa -- email@empresa.com");
  process.exit(1);
}

const db = getDb();
const user = db.select().from(usuarios).where(eq(usuarios.email, email)).get();
if (!user) {
  console.error(`Usuário não encontrado: ${email}`);
  process.exit(1);
}

db.transaction((tx) => {
  tx.update(usuarios).set({ totpSegredoCifrado: null, totpAtivo: false, totpUltimoPasso: null }).where(eq(usuarios.id, user.id)).run();
  tx.delete(codigosRecuperacao).where(eq(codigosRecuperacao.usuarioId, user.id)).run();
  tx.delete(mfaPendentes).where(eq(mfaPendentes.usuarioId, user.id)).run();
  tx.delete(sessoes).where(eq(sessoes.usuarioId, user.id)).run();
});
recordAudit(db, { userId: null, acao: "2fa.redefinir_servidor", entidade: "usuario", entidadeId: user.id });
console.log(`2FA de ${email} redefinido. No próximo login será pedido para configurar o autenticador.`);
