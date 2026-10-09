"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { guard, type ActionState } from "@/app/_shared/actions";
import { recordAudit } from "@/infra/audit";
import { cookieSecure, MFA_COOKIE, SESSION_COOKIE } from "@/app/_shared/session";
import { createChallenge, CHALLENGE_MINUTES } from "@/modules/auth/mfa";
import { verifyPassword } from "@/modules/auth/password";
import { revokeSession } from "@/modules/auth/sessions";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/modules/auth/throttle";
import { getDb } from "@/infra/db/client";
import { usuarios } from "@/infra/db/schema";
import { ValidationError } from "@/infra/validation";

const loginSchema = z.object({ email: z.string().trim().toLowerCase().min(3).max(160), senha: z.string().min(1).max(200) });
const GENERIC = "E-mail ou senha inválidos.";
// Hash falso para igualar o tempo de resposta quando o usuário não existe.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Qd0rGZ7mN1vYb8rC5v4FJm0n3m1lq0g2dO2q9E0yK0A";

/** Passo 1: confere e-mail e senha. Não cria sessão — só abre a etapa do código 2FA. */
export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let next = false;
  const result = await guard(async () => {
    const parsed = loginSchema.safeParse({ email: formData.get("email"), senha: formData.get("senha") });
    if (!parsed.success) throw new ValidationError({ _: GENERIC });
    const { email, senha } = parsed.data;

    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    const keys = [`email:${email}`, `ip:${ip}`];
    for (const k of keys) {
      const c = checkLoginAllowed(k);
      if (!c.allowed) {
        throw new ValidationError({ _: `Muitas tentativas. Tente novamente em ${Math.ceil(c.retryAfterSec / 60)} min.` });
      }
    }

    const db = getDb();
    const user = db.select().from(usuarios).where(eq(usuarios.email, email)).get();
    const ok = await verifyPassword(user?.senhaHash ?? DUMMY_HASH, senha);
    if (!user || !user.ativo || !ok) {
      keys.forEach((k) => recordLoginFailure(k));
      recordAudit(db, { userId: user?.id ?? null, acao: "login.falha", entidade: "usuario", entidadeId: user?.id, depois: { email } });
      throw new ValidationError({ _: GENERIC });
    }

    keys.forEach((k) => clearLoginFailures(k));
    const { token, expiresAt } = createChallenge(db, user.id);
    (await cookies()).set(MFA_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure(),
      path: "/login",
      maxAge: CHALLENGE_MINUTES * 60,
      expires: expiresAt,
    });
    recordAudit(db, { userId: user.id, acao: "login.senha_ok", entidade: "usuario", entidadeId: user.id });
    next = true;
  });
  if (next) redirect("/login/2fa");
  return result;
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(getDb(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
