// Promove um usuário existente a Root. Uso: npm run promote-root -- email@empresa.com
import { eq } from "drizzle-orm";
import { recordAudit } from "../../src/infra/audit";
import { getDb } from "../../src/infra/db/client";
import { usuarios } from "../../src/infra/db/schema";
import { ask } from "./_account";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Uso: npm run promote-root -- email@empresa.com");
  const db = getDb();
  const user = db.select().from(usuarios).where(eq(usuarios.email, email)).get();
  if (!user) throw new Error(`Usuário não encontrado: ${email}`);
  if (user.perfil === "root") throw new Error(`${email} já é Root.`);

  const ans = await ask(`Promover ${user.nome} <${email}> (${user.perfil}) a Root? Digite SIM para confirmar: `);
  if (ans.trim().toUpperCase() !== "SIM") throw new Error("Cancelado.");

  db.update(usuarios).set({ perfil: "root", podeVerCusto: true, ativo: true }).where(eq(usuarios.id, user.id)).run();
  recordAudit(db, { userId: null, acao: "usuario.promover_root", entidade: "usuario", entidadeId: user.id, antes: { perfil: user.perfil }, depois: { perfil: "root" } });
  console.log(`${email} agora é Root.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
