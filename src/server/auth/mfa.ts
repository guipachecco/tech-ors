import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { recordAudit } from "../audit";
import type { Db } from "../db/client";
import { codigosRecuperacao, mfaPendentes, sessoes, usuarios } from "../db/schema";
import { NotFoundError } from "../validation";
import { assertCan } from "./permissions";
import type { SessionUser } from "./sessions";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "./throttle";
import {
  decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, newTotpSecret, totpUri, verifyTotp,
} from "./totp";

export const CHALLENGE_MINUTES = 5;
export const MAX_CHALLENGE_ATTEMPTS = 5;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type Challenge = {
  id: number;
  userId: number;
  email: string;
  nome: string;
  totpAtivo: boolean;
  segredoPendenteCifrado: string | null;
};

/** Cria a etapa do 2FA depois da senha correta. O token vai num cookie curto; só o hash fica no banco. */
export function createChallenge(db: Db, userId: number, now = new Date()): { token: string; expiresAt: Date } {
  db.delete(mfaPendentes).where(lt(mfaPendentes.expiraEm, now)).run();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + CHALLENGE_MINUTES * 60_000);
  db.insert(mfaPendentes).values({ tokenHash: hashToken(token), usuarioId: userId, expiraEm: expiresAt }).run();
  return { token, expiresAt };
}

export function getChallenge(db: Db, token: string, now = new Date()): Challenge | null {
  if (!token) return null;
  const row = db
    .select({
      id: mfaPendentes.id,
      userId: usuarios.id,
      email: usuarios.email,
      nome: usuarios.nome,
      ativo: usuarios.ativo,
      totpAtivo: usuarios.totpAtivo,
      tentativas: mfaPendentes.tentativas,
      expiraEm: mfaPendentes.expiraEm,
      segredoPendenteCifrado: mfaPendentes.segredoPendenteCifrado,
    })
    .from(mfaPendentes)
    .innerJoin(usuarios, eq(usuarios.id, mfaPendentes.usuarioId))
    .where(eq(mfaPendentes.tokenHash, hashToken(token)))
    .get();
  if (!row || !row.ativo || row.expiraEm.getTime() <= now.getTime() || row.tentativas >= MAX_CHALLENGE_ATTEMPTS) return null;
  const { ativo: _a, tentativas: _t, expiraEm: _e, ...challenge } = row;
  return challenge;
}

export function discardChallenge(db: Db, token: string): void {
  db.delete(mfaPendentes).where(eq(mfaPendentes.tokenHash, hashToken(token))).run();
}

function failAttempt(db: Db, challengeId: number, userId: number, now: Date) {
  const row = db.select().from(mfaPendentes).where(eq(mfaPendentes.id, challengeId)).get();
  if (row) db.update(mfaPendentes).set({ tentativas: row.tentativas + 1 }).where(eq(mfaPendentes.id, challengeId)).run();
  recordLoginFailure(`mfa:${userId}`, now);
}

// ---------- configuração inicial (primeiro login) ----------

/** Gera (ou reaproveita) o segredo pendente da etapa. O usuário só passa a ter 2FA depois de confirmar um código. */
export function prepareEnrollment(db: Db, keyHex: string, token: string, now = new Date()): { secret: string; uri: string } | null {
  const ch = getChallenge(db, token, now);
  if (!ch || ch.totpAtivo) return null; // quem já tem 2FA não pode trocar o autenticador só com a senha
  let secret: string;
  if (ch.segredoPendenteCifrado) {
    secret = decryptSecret(ch.segredoPendenteCifrado, keyHex);
  } else {
    secret = newTotpSecret();
    db.update(mfaPendentes).set({ segredoPendenteCifrado: encryptSecret(secret, keyHex) }).where(eq(mfaPendentes.id, ch.id)).run();
  }
  return { secret, uri: totpUri(ch.email, secret) };
}

export type EnrollmentResult = { ok: true; userId: number; recoveryCodes: string[] } | { ok: false; error: string };

export function completeEnrollment(db: Db, keyHex: string, token: string, code: string, now = new Date()): EnrollmentResult {
  const ch = getChallenge(db, token, now);
  if (!ch || ch.totpAtivo || !ch.segredoPendenteCifrado) return { ok: false, error: "A etapa expirou. Entre novamente com e-mail e senha." };
  if (!checkLoginAllowed(`mfa:${ch.userId}`, now).allowed) return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." };

  const secret = decryptSecret(ch.segredoPendenteCifrado, keyHex);
  const result = verifyTotp(secret, code, null, now);
  if (!result.ok) {
    failAttempt(db, ch.id, ch.userId, now);
    return { ok: false, error: "Código incorreto. Confira o horário do celular e tente de novo." };
  }

  const recoveryCodes = generateRecoveryCodes();
  db.transaction((tx) => {
    tx.update(usuarios).set({ totpSegredoCifrado: ch.segredoPendenteCifrado, totpAtivo: true, totpUltimoPasso: result.step }).where(eq(usuarios.id, ch.userId)).run();
    tx.delete(codigosRecuperacao).where(eq(codigosRecuperacao.usuarioId, ch.userId)).run();
    for (const c of recoveryCodes) tx.insert(codigosRecuperacao).values({ usuarioId: ch.userId, codigoHash: hashRecoveryCode(c) }).run();
    tx.delete(mfaPendentes).where(eq(mfaPendentes.id, ch.id)).run();
  });
  clearLoginFailures(`mfa:${ch.userId}`);
  recordAudit(db, { userId: ch.userId, acao: "2fa.ativar", entidade: "usuario", entidadeId: ch.userId });
  return { ok: true, userId: ch.userId, recoveryCodes };
}

// ---------- verificação no login ----------

export type LoginMfaResult = { ok: true; userId: number; usedRecovery: boolean } | { ok: false; error: string };

export function verifyLoginCode(db: Db, keyHex: string, token: string, code: string, now = new Date()): LoginMfaResult {
  const ch = getChallenge(db, token, now);
  if (!ch || !ch.totpAtivo) return { ok: false, error: "A etapa expirou. Entre novamente com e-mail e senha." };
  const gate = checkLoginAllowed(`mfa:${ch.userId}`, now);
  if (!gate.allowed) return { ok: false, error: `Muitas tentativas. Tente novamente em ${Math.ceil(gate.retryAfterSec / 60)} min.` };

  const user = db.select().from(usuarios).where(eq(usuarios.id, ch.userId)).get();
  if (!user?.totpSegredoCifrado) return { ok: false, error: "2FA não configurado para este usuário." };

  let secret: string;
  try {
    secret = decryptSecret(user.totpSegredoCifrado, keyHex);
  } catch {
    // Chave do .env diferente da usada ao cadastrar o 2FA (ou dado corrompido).
    return { ok: false, error: "Não foi possível ler o 2FA deste usuário. Peça a um administrador para redefinir (ou use npm run reset-2fa no servidor)." };
  }
  const totp = verifyTotp(secret, code, user.totpUltimoPasso, now);
  if (totp.ok) {
    // Atualização condicional: se duas requisições usarem o mesmo código ao mesmo tempo, só uma vence.
    const upd = db
      .update(usuarios)
      .set({ totpUltimoPasso: totp.step })
      .where(and(eq(usuarios.id, user.id), or(isNull(usuarios.totpUltimoPasso), lt(usuarios.totpUltimoPasso, totp.step))))
      .run();
    if (upd.changes === 1) {
      db.delete(mfaPendentes).where(eq(mfaPendentes.id, ch.id)).run();
      clearLoginFailures(`mfa:${user.id}`);
      return { ok: true, userId: user.id, usedRecovery: false };
    }
  } else if (/^[A-Za-z0-9\s-]{8,16}$/.test(code) && !/^\d{6}$/.test(code.replace(/\s/g, ""))) {
    const used = db
      .update(codigosRecuperacao)
      .set({ usadoEm: now })
      .where(and(eq(codigosRecuperacao.usuarioId, user.id), eq(codigosRecuperacao.codigoHash, hashRecoveryCode(code)), isNull(codigosRecuperacao.usadoEm)))
      .run();
    if (used.changes === 1) {
      db.delete(mfaPendentes).where(eq(mfaPendentes.id, ch.id)).run();
      clearLoginFailures(`mfa:${user.id}`);
      recordAudit(db, { userId: user.id, acao: "2fa.codigo_recuperacao_usado", entidade: "usuario", entidadeId: user.id });
      return { ok: true, userId: user.id, usedRecovery: true };
    }
  }
  failAttempt(db, ch.id, user.id, now);
  return { ok: false, error: "Código inválido." };
}

export function remainingRecoveryCodes(db: Db, userId: number): number {
  return db.select().from(codigosRecuperacao).where(and(eq(codigosRecuperacao.usuarioId, userId), isNull(codigosRecuperacao.usadoEm))).all().length;
}

// ---------- administração ----------

/** Perdeu o celular: o administrador zera o 2FA e o usuário configura de novo no próximo login. */
export function resetUserMfa(db: Db, actor: SessionUser, userId: number): void {
  assertCan(actor, "user:manage");
  const u = db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.id, userId)).get();
  if (!u) throw new NotFoundError("Usuário");
  db.transaction((tx) => {
    tx.update(usuarios).set({ totpSegredoCifrado: null, totpAtivo: false, totpUltimoPasso: null }).where(eq(usuarios.id, userId)).run();
    tx.delete(codigosRecuperacao).where(eq(codigosRecuperacao.usuarioId, userId)).run();
    tx.delete(mfaPendentes).where(eq(mfaPendentes.usuarioId, userId)).run();
    tx.delete(sessoes).where(eq(sessoes.usuarioId, userId)).run();
  });
  recordAudit(db, { userId: actor.id, acao: "2fa.redefinir", entidade: "usuario", entidadeId: userId });
}
