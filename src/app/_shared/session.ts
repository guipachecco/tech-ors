import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/infra/db/client";
import { can, type Action } from "@/modules/auth/permissions";
import { loadConfig } from "@/infra/config";
import { createSession, validateSession, type SessionUser } from "@/modules/auth/sessions";

export const SESSION_COOKIE = "sid";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await validateSession(getDb(), token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireCan(action: Action): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, action)) redirect("/acesso-negado");
  return user;
}

export const MFA_COOKIE = "mfa";
/** Cookie curto (HttpOnly, criptografado) que leva os códigos de recuperação até a página que os exibe. */
export const RECOVERY_COOKIE = "rc";

/** Cria a sessão e o cookie. Só deve ser chamada depois da senha E do segundo fator. */
export async function startSession(userId: number): Promise<void> {
  const { token, expiresAt } = await createSession(getDb(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt,
  });
}

export function cookieSecure(): boolean {
  return loadConfig().isProduction && process.env.INSECURE_COOKIES !== "1";
}
