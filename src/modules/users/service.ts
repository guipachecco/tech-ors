import { eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/infra/audit";
import { assertCan, can, ForbiddenError } from "../auth/permissions";
import { assertCanManageTarget } from "../auth/protect";
import { hashPassword, validatePasswordStrength } from "../auth/password";
import type { SessionUser } from "../auth/sessions";
import type { Db } from "@/infra/db/client";
import { sessoes, usuarios } from "@/infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "@/infra/validation";

export type UserRow = Omit<typeof usuarios.$inferSelect, "senhaHash" | "totpSegredoCifrado" | "totpUltimoPasso">;

const publicCols = {
  id: usuarios.id, nome: usuarios.nome, email: usuarios.email, perfil: usuarios.perfil,
  podeVerCusto: usuarios.podeVerCusto, ativo: usuarios.ativo, totpAtivo: usuarios.totpAtivo, criadoEm: usuarios.criadoEm,
};

export async function listUsers(db: Db, actor: SessionUser): Promise<UserRow[]> {
  assertCan(actor, "user:manage");
  return await db.select(publicCols).from(usuarios).orderBy(usuarios.nome).all();
}

const createSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").max(120),
  email: z.string().trim().toLowerCase().max(160).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "E-mail inválido"),
  senha: z.string().max(200),
  perfil: z.enum(["administrador", "vendedor"]),
  podeVerCusto: z.boolean(),
});

export async function createUser(db: Db, actor: SessionUser, input: z.input<typeof createSchema>): Promise<UserRow> {
  assertCan(actor, "user:manage");
  const data = parseInput(createSchema, input);
  // Administradores criam vendedores; criar administrador é do Root. O Root em si só nasce pelo servidor (npm run create-root).
  if (data.perfil === "administrador" && !can(actor, "admin:manage")) throw new ForbiddenError("criar administradores (somente o Root)");
  try {
    validatePasswordStrength(data.senha);
  } catch (e) {
    throw new ValidationError({ senha: (e as Error).message });
  }
  if (await db.select().from(usuarios).where(eq(usuarios.email, data.email)).get()) {
    throw new ValidationError({ email: "Já existe um usuário com esse e-mail" });
  }
  const created = await db
    .insert(usuarios)
    .values({ nome: data.nome, email: data.email, senhaHash: await hashPassword(data.senha), perfil: data.perfil, podeVerCusto: data.perfil === "administrador" ? true : data.podeVerCusto })
    .returning(publicCols)
    .get();
  await recordAudit(db, { userId: actor.id, acao: "usuario.criar", entidade: "usuario", entidadeId: created.id, depois: created });
  return created;
}

export async function updateUserAccess(db: Db, actor: SessionUser, userId: number, patch: { ativo?: boolean; podeVerCusto?: boolean }): Promise<UserRow> {
  assertCan(actor, "user:manage");
  const target = await assertCanManageTarget(db, actor, userId);
  const before = await db.select(publicCols).from(usuarios).where(eq(usuarios.id, userId)).get();
  if (!before) throw new NotFoundError("Usuário");
  if (target.perfil === "root" && patch.ativo === false) {
    throw new ValidationError({ _: "A conta Root não pode ser desativada pela aplicação" });
  }
  if (userId === actor.id && patch.ativo === false) {
    throw new ValidationError({ _: "Você não pode desativar o próprio usuário" });
  }
  const after = await db.update(usuarios).set(patch).where(eq(usuarios.id, userId)).returning(publicCols).get();
  if (patch.ativo === false) await db.delete(sessoes).where(eq(sessoes.usuarioId, userId)).run();
  await recordAudit(db, { userId: actor.id, acao: "usuario.acesso", entidade: "usuario", entidadeId: userId, antes: before, depois: after });
  return after;
}

export async function resetPassword(db: Db, actor: SessionUser, userId: number, senha: string): Promise<void> {
  assertCan(actor, "user:manage");
  try {
    validatePasswordStrength(senha);
  } catch (e) {
    throw new ValidationError({ senha: (e as Error).message });
  }
  await assertCanManageTarget(db, actor, userId);
  await db.update(usuarios).set({ senhaHash: await hashPassword(senha) }).where(eq(usuarios.id, userId)).run();
  await db.delete(sessoes).where(eq(sessoes.usuarioId, userId)).run();
  await recordAudit(db, { userId: actor.id, acao: "usuario.redefinir_senha", entidade: "usuario", entidadeId: userId });
}
