import * as OTPAuth from "otpauth";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  completeEnrollment, createChallenge, getChallenge, prepareEnrollment, remainingRecoveryCodes, resetUserMfa, verifyLoginCode,
} from "@/server/auth/mfa";
import { ForbiddenError } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/sessions";
import { createSession, validateSession } from "@/server/auth/sessions";
import { clearLoginFailures } from "@/server/auth/throttle";
import { codigosRecuperacao, usuarios } from "@/server/db/schema";
import { createTestDb } from "./helpers/testDb";

const KEY = "c3".repeat(32);
const T0 = new Date("2026-10-09T15:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

const codeFor = (secret: string, when: Date) =>
  new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: when.getTime() });

let seq = 0;
function setup() {
  const db = createTestDb();
  const n = ++seq;
  clearLoginFailures(`mfa:1`);
  const u = db.insert(usuarios).values({ nome: "Ana", email: `ana${n}@x.com`, senhaHash: "h", perfil: "vendedor" }).returning().get();
  const admin = db.insert(usuarios).values({ nome: "Adm", email: `adm${n}@x.com`, senhaHash: "h", perfil: "administrador", podeVerCusto: true }).returning().get();
  const adminU: SessionUser = { id: admin.id, nome: admin.nome, email: admin.email, perfil: "administrador", podeVerCusto: true };
  clearLoginFailures(`mfa:${u.id}`);
  return { db, u, adminU };
}

function enroll(db: ReturnType<typeof setup>["db"], userId: number) {
  const { token } = createChallenge(db, userId, T0);
  const prep = prepareEnrollment(db, KEY, token, T0)!;
  const done = completeEnrollment(db, KEY, token, codeFor(prep.secret, T0), T0);
  if (!done.ok) throw new Error(done.error);
  return { secret: prep.secret, recoveryCodes: done.recoveryCodes };
}

describe("enrollment", () => {
  it("creates a pending secret, stored encrypted, and activates only after a valid code", () => {
    const { db, u } = setup();
    const { token } = createChallenge(db, u.id, T0);
    const prep = prepareEnrollment(db, KEY, token, T0)!;
    expect(prep.uri).toContain("otpauth://totp/");
    expect(prepareEnrollment(db, KEY, token, T0)!.secret).toBe(prep.secret); // reaproveita o mesmo segredo

    const before = db.select().from(usuarios).where(eq(usuarios.id, u.id)).get()!;
    expect(before.totpAtivo).toBe(false);
    expect(before.totpSegredoCifrado).toBeNull();

    const wrong = completeEnrollment(db, KEY, token, "000000", T0);
    expect(wrong.ok).toBe(false);
    expect(db.select().from(usuarios).where(eq(usuarios.id, u.id)).get()!.totpAtivo).toBe(false);

    const ok = completeEnrollment(db, KEY, token, codeFor(prep.secret, T0), T0);
    expect(ok.ok).toBe(true);
    const after = db.select().from(usuarios).where(eq(usuarios.id, u.id)).get()!;
    expect(after.totpAtivo).toBe(true);
    expect(after.totpSegredoCifrado).not.toContain(prep.secret);
    expect(remainingRecoveryCodes(db, u.id)).toBe(10);
    expect(getChallenge(db, token, T0)).toBeNull(); // etapa consumida
  });

  it("stores only hashes of the recovery codes", () => {
    const { db, u } = setup();
    const { recoveryCodes } = enroll(db, u.id);
    const stored = db.select().from(codigosRecuperacao).all().map((r) => r.codigoHash).join(" ");
    for (const c of recoveryCodes) expect(stored).not.toContain(c.replace("-", ""));
  });

  it("does not let someone with only the password replace an active authenticator", () => {
    const { db, u } = setup();
    enroll(db, u.id);
    const { token } = createChallenge(db, u.id, at(60));
    expect(prepareEnrollment(db, KEY, token, at(60))).toBeNull();
    expect(completeEnrollment(db, KEY, token, "123456", at(60)).ok).toBe(false);
  });
});

describe("login verification", () => {
  it("accepts a valid code once and refuses replay", () => {
    const { db, u } = setup();
    const { secret } = enroll(db, u.id);
    const t = at(90);
    const code = codeFor(secret, t);
    const c1 = createChallenge(db, u.id, t);
    expect(verifyLoginCode(db, KEY, c1.token, code, t)).toEqual({ ok: true, userId: u.id, usedRecovery: false });
    const c2 = createChallenge(db, u.id, t);
    expect(verifyLoginCode(db, KEY, c2.token, code, t).ok).toBe(false); // mesmo código, mesmo passo
  });

  it("expires the challenge after 5 minutes", () => {
    const { db, u } = setup();
    const { secret } = enroll(db, u.id);
    const c = createChallenge(db, u.id, at(120));
    const late = at(120 + 5 * 60 + 1);
    expect(verifyLoginCode(db, KEY, c.token, codeFor(secret, late), late).ok).toBe(false);
  });

  it("locks the challenge after 5 wrong codes, even if the right one comes next", () => {
    const { db, u } = setup();
    const { secret } = enroll(db, u.id);
    const t = at(150);
    const c = createChallenge(db, u.id, t);
    for (let i = 0; i < 5; i++) expect(verifyLoginCode(db, KEY, c.token, "000000", t).ok).toBe(false);
    expect(verifyLoginCode(db, KEY, c.token, codeFor(secret, t), t).ok).toBe(false);
  });

  it("limits guesses per user across fresh challenges (password is not enough to keep trying)", () => {
    const { db, u } = setup();
    const { secret } = enroll(db, u.id);
    const t = at(180);
    for (let round = 0; round < 3; round++) {
      const c = createChallenge(db, u.id, t);
      for (let i = 0; i < 2; i++) verifyLoginCode(db, KEY, c.token, "000000", t);
    }
    const fresh = createChallenge(db, u.id, t);
    const r = verifyLoginCode(db, KEY, fresh.token, codeFor(secret, t), t);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Muitas tentativas");
  });

  it("accepts each recovery code only once", () => {
    const { db, u } = setup();
    const { recoveryCodes } = enroll(db, u.id);
    const t = at(200);
    const c1 = createChallenge(db, u.id, t);
    expect(verifyLoginCode(db, KEY, c1.token, recoveryCodes[0].toLowerCase(), t)).toEqual({ ok: true, userId: u.id, usedRecovery: true });
    const c2 = createChallenge(db, u.id, t);
    expect(verifyLoginCode(db, KEY, c2.token, recoveryCodes[0], t).ok).toBe(false);
    expect(remainingRecoveryCodes(db, u.id)).toBe(9);
  });

  it("rejects inactive users", () => {
    const { db, u } = setup();
    const { secret } = enroll(db, u.id);
    const t = at(220);
    const c = createChallenge(db, u.id, t);
    db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, u.id)).run();
    expect(verifyLoginCode(db, KEY, c.token, codeFor(secret, t), t).ok).toBe(false);
  });
});

describe("admin reset", () => {
  it("clears 2FA, recovery codes and sessions; only administrators can do it", async () => {
    const { db, u, adminU } = setup();
    enroll(db, u.id);
    const { token } = await createSession(db, u.id);
    const sellerU: SessionUser = { id: u.id, nome: u.nome, email: u.email, perfil: "vendedor", podeVerCusto: false };
    expect(() => resetUserMfa(db, sellerU, u.id)).toThrow(ForbiddenError);

    resetUserMfa(db, adminU, u.id);
    const row = db.select().from(usuarios).where(eq(usuarios.id, u.id)).get()!;
    expect(row).toMatchObject({ totpAtivo: false, totpSegredoCifrado: null, totpUltimoPasso: null });
    expect(remainingRecoveryCodes(db, u.id)).toBe(0);
    expect(await validateSession(db, token)).toBeNull();
    const c = createChallenge(db, u.id, at(300));
    expect(prepareEnrollment(db, KEY, c.token, at(300))).not.toBeNull(); // pode configurar de novo
  });
});
