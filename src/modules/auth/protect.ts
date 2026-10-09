import { eq } from "drizzle-orm";
import type { Db } from "@/infra/db/client";
import { usuarios } from "@/infra/db/schema";
import { NotFoundError } from "@/infra/validation";
import { ForbiddenError } from "./permissions";
import type { SessionUser } from "./sessions";

/**
 * A conta Root é do dono do sistema: só o próprio Root altera (senha, 2FA, acesso).
 * Vale para todo caminho que mexe em outro usuário — interface, ações e serviços.
 */
export function assertCanManageTarget(db: Db, actor: SessionUser, targetId: number): { id: number; perfil: SessionUser["perfil"] } {
  const target = db.select({ id: usuarios.id, perfil: usuarios.perfil }).from(usuarios).where(eq(usuarios.id, targetId)).get();
  if (!target) throw new NotFoundError("Usuário");
  if (target.perfil === "root" && actor.perfil !== "root") {
    throw new ForbiddenError("alterar o usuário Root (somente o próprio Root)");
  }
  return target;
}
