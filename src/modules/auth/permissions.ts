import type { SessionUser } from "./sessions";

export type Action =
  | "cost:view"
  | "cost:write"
  | "margin:manage"
  | "quote:override"
  | "user:manage"
  | "settings:manage"
  /** Criar/promover administradores e alterar contas de administrador: só o Root. */
  | "admin:manage";

export class ForbiddenError extends Error {
  constructor(action?: string) {
    super(action ? `Sem permissão para: ${action}` : "Sem permissão");
    this.name = "ForbiddenError";
  }
}

export function can(user: SessionUser, action: Action): boolean {
  if (user.perfil === "root") return true;
  if (user.perfil === "administrador") return action !== "admin:manage";
  if (action === "cost:view" || action === "cost:write") return user.podeVerCusto;
  return false;
}

export function assertCan(user: SessionUser, action: Action): void {
  if (!can(user, action)) throw new ForbiddenError(action);
}
