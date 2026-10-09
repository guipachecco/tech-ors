import readline from "node:readline";
import { eq } from "drizzle-orm";
import { recordAudit } from "../../src/infra/audit";
import { hashPassword, validatePasswordStrength } from "../../src/modules/auth/password";
import { ensureMigrated, getDb } from "../../src/infra/db/client";
import { usuarios } from "../../src/infra/db/schema";

export function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void };
      out._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** Pergunta nome, e-mail e senha (oculta) e cria a conta com o perfil dado. */
export async function createAccount(perfil: "administrador" | "root"): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  if (perfil === "root") {
    const existing = await db.select({ email: usuarios.email }).from(usuarios).where(eq(usuarios.perfil, "root")).all();
    if (existing.length > 0) {
      const ans = await ask(`Já existe Root (${existing.map((r) => r.email).join(", ")}). Criar outro mesmo assim? (digite SIM) `);
      if (ans.trim().toUpperCase() !== "SIM") throw new Error("Cancelado.");
    }
  }
  const nome = (await ask("Nome: ")).trim();
  const email = (await ask("E-mail: ")).trim().toLowerCase();
  const senha = await ask("Senha (mín. 10 caracteres): ", true);
  const confirma = await ask("Repita a senha: ", true);
  if (!nome || !email.includes("@")) throw new Error("Nome e e-mail válidos são obrigatórios.");
  if (senha !== confirma) throw new Error("As senhas não conferem.");
  validatePasswordStrength(senha);
  if (await db.select().from(usuarios).where(eq(usuarios.email, email)).get()) {
    throw new Error("Já existe um usuário com esse e-mail. Para promover um usuário existente: npm run promote-root -- email");
  }

  const created = await db
    .insert(usuarios)
    .values({ nome, email, senhaHash: await hashPassword(senha), perfil, podeVerCusto: true })
    .returning()
    .get();
  await recordAudit(db, { userId: null, acao: perfil === "root" ? "usuario.criar_root" : "usuario.criar_admin", entidade: "usuario", entidadeId: created.id, depois: { nome, email, perfil } });
  console.log(`${perfil === "root" ? "Root" : "Administrador"} criado: ${email}\nNo primeiro login você configura o Google Authenticator.`);
}
