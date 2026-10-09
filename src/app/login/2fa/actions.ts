"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { recordAudit } from "@/infra/audit";
import { cookieSecure, MFA_COOKIE, RECOVERY_COOKIE, startSession } from "@/app/_shared/session";
import { completeEnrollment, discardChallenge, verifyLoginCode } from "@/modules/auth/mfa";
import { encryptSecret } from "@/modules/auth/totp";
import { totpKey } from "@/modules/auth/totpKey";
import { getDb } from "@/infra/db/client";

export type MfaState = { error?: string } | null;

const codeOf = (fd: FormData) => String(fd.get("codigo") ?? "").slice(0, 32);

async function mfaToken(): Promise<string> {
  return (await cookies()).get(MFA_COOKIE)?.value ?? "";
}

/** Passo 2 (quem já tem autenticador): confere o código e só então cria a sessão. */
export async function verifyCodeAction(_prev: MfaState, fd: FormData): Promise<MfaState> {
  const token = await mfaToken();
  const result = verifyLoginCode(getDb(), totpKey(), token, codeOf(fd));
  if (!result.ok) return { error: result.error };
  (await cookies()).delete({ name: MFA_COOKIE, path: "/login" });
  await startSession(result.userId);
  recordAudit(getDb(), { userId: result.userId, acao: "login.ok", entidade: "usuario", entidadeId: result.userId, depois: { recuperacao: result.usedRecovery } });
  redirect("/orcamentos");
}

/** Passo 2 (primeiro acesso): confirma o autenticador, cria a sessão e leva aos códigos de recuperação (mostrados uma única vez). */
export async function enrollAction(_prev: MfaState, fd: FormData): Promise<MfaState> {
  const token = await mfaToken();
  const result = completeEnrollment(getDb(), totpKey(), token, codeOf(fd));
  if (!result.ok) return { error: result.error };
  const jar = await cookies();
  jar.delete({ name: MFA_COOKIE, path: "/login" });
  jar.set(RECOVERY_COOKIE, encryptSecret(JSON.stringify(result.recoveryCodes), totpKey()), {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/login/2fa",
    maxAge: 600,
  });
  await startSession(result.userId);
  recordAudit(getDb(), { userId: result.userId, acao: "login.ok", entidade: "usuario", entidadeId: result.userId, depois: { primeiroAcesso2fa: true } });
  redirect("/login/2fa/codigos");
}

/** Usuário confirmou que guardou os códigos: apaga o cookie e segue para o sistema. */
export async function finishMfaAction(): Promise<void> {
  (await cookies()).delete({ name: RECOVERY_COOKIE, path: "/login/2fa" });
  redirect("/orcamentos");
}

export async function cancelMfaAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  if (token) discardChallenge(getDb(), token);
  jar.delete({ name: MFA_COOKIE, path: "/login" });
  redirect("/login");
}
