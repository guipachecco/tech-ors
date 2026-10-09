import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/infra/db/client";
import { sessoes, usuarios } from "@/infra/db/schema";

export const SESSION_HOURS = 12;

export type Role = "root" | "administrador" | "vendedor";
export type SessionUser = {
  id: number;
  nome: string;
  email: string;
  perfil: Role;
  podeVerCusto: boolean;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: number, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  db.insert(sessoes).values({ tokenHash: hashToken(token), usuarioId: userId, expiraEm: expiresAt }).run();
  return { token, expiresAt };
}

export async function validateSession(db: Db, token: string, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const row = db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      perfil: usuarios.perfil,
      podeVerCusto: usuarios.podeVerCusto,
    })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.tokenHash, hashToken(token)), gt(sessoes.expiraEm, now), eq(usuarios.ativo, true)))
    .get();
  return row ?? null;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  db.delete(sessoes).where(eq(sessoes.tokenHash, hashToken(token))).run();
}
