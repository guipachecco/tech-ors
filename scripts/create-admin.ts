import readline from "node:readline";
import { eq } from "drizzle-orm";
import { recordAudit } from "../src/server/audit";
import { hashPassword, validatePasswordStrength } from "../src/server/auth/password";
import { getDb } from "../src/server/db/client";
import { usuarios } from "../src/server/db/schema";

function ask(question: string, hidden = false): Promise<string> {
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

async function main() {
  const nome = (await ask("Nome: ")).trim();
  const email = (await ask("E-mail: ")).trim().toLowerCase();
  const senha = await ask("Senha (mín. 10 caracteres): ", true);
  const confirma = await ask("Repita a senha: ", true);
  if (!nome || !email.includes("@")) throw new Error("Nome e e-mail válidos são obrigatórios.");
  if (senha !== confirma) throw new Error("As senhas não conferem.");
  validatePasswordStrength(senha);

  const db = getDb();
  if (db.select().from(usuarios).where(eq(usuarios.email, email)).get()) {
    throw new Error("Já existe um usuário com esse e-mail.");
  }
  const created = db
    .insert(usuarios)
    .values({ nome, email, senhaHash: await hashPassword(senha), perfil: "administrador", podeVerCusto: true })
    .returning()
    .get();
  recordAudit(db, { userId: null, acao: "usuario.criar_admin", entidade: "usuario", entidadeId: created.id, depois: { nome, email } });
  console.log(`Administrador criado: ${email}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
