import * as OTPAuth from "otpauth";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  completeEnrollment, createChallenge, getChallenge, prepareEnrollment, remainingRecoveryCodes, resetUserMfa, verifyLoginCode,
} from "@/modules/auth/mfa";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { createSession, validateSession } from "@/modules/auth/sessions";
import { clearLoginFailures } from "@/modules/auth/throttle";
import { codigosRecuperacao, usuarios } from "@/infra/db/schema";
import { createTestDb } from "../../helpers/testDb";

const KEY = "c3".repeat(32);
const T0 = new Date("2026-10-09T15:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

const codeFor = (secret: string, when: Date) =>
  new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: when.getTime() });

let seq = 0;
async function setup() {
  const db = await createTestDb();
  const n = ++seq;
  const u = await db.insert(usuarios).values({ nome: "Ana", email: `ana${n}@x.com`, senhaHash: "h", perfil: "vendedor" }).returning().get();
  const admin = await db.insert(usuarios).values({ nome: "Adm", email: `adm${n}@x.com`, senhaHash: "h", perfil: "administrador", podeVerCusto: true }).returning().get();
  const adminU: SessionUser = { id: admin.id, nome: admin.nome, email: admin.email, perfil: "administrador", podeVerCusto: true };
  return { db, u, adminU };
}

async function enroll(db: Awaited<ReturnType<typeof setup>>["db"], userId: number) {
  const { token } = await createChallenge(db, userId, T0);
  const prep = (await prepareEnrollment(db, KEY, token, T0))!;
  const done = await completeEnrollment(db, KEY, token, codeFor(prep.secret, T0), T0);
  if (!done.ok) throw new Error(done.error);
  return { secret: prep.secret, recoveryCodes: done.recoveryCodes };
}

describe("enrollment", () => {
  it("creates a pending secret, stored encrypted, and activates only after a valid code", async () => {
    const { db, u } = await setup();
    const { token } = await createChallenge(db, u.id, T0);
    const prep = (await prepareEnrollment(db, KEY, token, T0))!;
    expect(prep.uri).toContain("otpauth://totp/");
    expect((await prepareEnrollment(db, KEY, token, T0))!.secret).toBe(prep.secret); // reaproveita o mesmo segredo

    const before = (await db.select().from(usuarios).where(eq(usuarios.id, u.id)).get())!;
    expect(before.totpAtivo).toBe(false);
    expect(before.totpSegredoCifrado).toBeNull();

    const wrong = await completeEnrollment(db, KEY, token, "000000", T0);
    expect(wrong.ok).toBe(false);
    expect((await db.select().from(usuarios).where(eq(usuarios.id, u.id)).get())!.totpAtivo).toBe(false);

    const ok = await completeEnrollment(db, KEY, token, codeFor(prep.secret, T0), T0);
    expect(ok.ok).toBe(true);
    const after = (await db.select().from(usuarios).where(eq(usuarios.id, u.id)).get())!;
    expect(after.totpAtivo).toBe(true);
    expect(after.totpSegredoCifrado).not.toContain(prep.secret);
    expect(await remainingRecoveryCodes(db, u.id)).toBe(10);
    expect(await getChallenge(db, token, T0)).toBeNull(); // etapa consumida
  });

  it("stores only hashes of the recovery codes", async () => {
    const { db, u } = await setup();
    const { recoveryCodes } = await enroll(db, u.id);
    const stored = (await db.select().from(codigosRecuperacao).all()).map((r) => r.codigoHash).join(" ");
    for (const c of recoveryCodes) expect(stored).not.toContain(c.replace("-", ""));
  });

  it("does not let someone with only the password replace an active authenticator", async () => {
    const { db, u } = await setup();
    await enroll(db, u.id);
    const { token } = await createChallenge(db, u.id, at(60));
    expect(await prepareEnrollment(db, KEY, token, at(60))).toBeNull();
    expect((await completeEnrollment(db, KEY, token, "123456", at(60))).ok).toBe(false);
  });
});

describe("login verification", () => {
  it("accepts a valid code once and refuses replay", async () => {
    const { db, u } = await setup();
    const { secret } = await enroll(db, u.id);
    const t = at(90);
    const code = codeFor(secret, t);
    const c1 = await createChallenge(db, u.id, t);
    expect(await verifyLoginCode(db, KEY, c1.token, code, t)).toEqual({ ok: true, userId: u.id, usedRecovery: false });
    const c2 = await createChallenge(db, u.id, t);
    expect((await verifyLoginCode(db, KEY, c2.token, code, t)).ok).toBe(false); // mesmo código, mesmo passo
  });

  it("expires the challenge after 5 minutes", async () => {
    const { db, u } = await setup();
    const { secret } = await enroll(db, u.id);
    const c = await createChallenge(db, u.id, at(120));
    const late = at(120 + 5 * 60 + 1);
    expect((await verifyLoginCode(db, KEY, c.token, codeFor(secret, late), late)).ok).toBe(false);
  });

  it("locks the challenge after 5 wrong codes, even if the right one comes next", async () => {
    const { db, u } = await setup();
    const { secret } = await enroll(db, u.id);
    const t = at(150);
    const c = await createChallenge(db, u.id, t);
    for (let i = 0; i < 5; i++) expect((await verifyLoginCode(db, KEY, c.token, "000000", t)).ok).toBe(false);
    expect((await verifyLoginCode(db, KEY, c.token, codeFor(secret, t), t)).ok).toBe(false);
  });

  it("limits guesses per user across fresh challenges (password is not enough to keep trying)", async () => {
    const { db, u } = await setup();
    const { secret } = await enroll(db, u.id);
    const t = at(180);
    for (let round = 0; round < 3; round++) {
      const c = await createChallenge(db, u.id, t);
      for (let i = 0; i < 2; i++) await verifyLoginCode(db, KEY, c.token, "000000", t);
    }
    const fresh = await createChallenge(db, u.id, t);
    const r = await verifyLoginCode(db, KEY, fresh.token, codeFor(secret, t), t);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Muitas tentativas");
  });

  it("accepts each recovery code only once", async () => {
    const { db, u } = await setup();
    const { recoveryCodes } = await enroll(db, u.id);
    const t = at(200);
    const c1 = await createChallenge(db, u.id, t);
    expect(await verifyLoginCode(db, KEY, c1.token, recoveryCodes[0].toLowerCase(), t)).toEqual({ ok: true, userId: u.id, usedRecovery: true });
    const c2 = await createChallenge(db, u.id, t);
    expect((await verifyLoginCode(db, KEY, c2.token, recoveryCodes[0], t)).ok).toBe(false);
    expect(await remainingRecoveryCodes(db, u.id)).toBe(9);
  });

  it("rejects inactive users", async () => {
    const { db, u } = await setup();
    const { secret } = await enroll(db, u.id);
    const t = at(220);
    const c = await createChallenge(db, u.id, t);
    await db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, u.id)).run();
    expect((await verifyLoginCode(db, KEY, c.token, codeFor(secret, t), t)).ok).toBe(false);
  });
});

describe("admin reset", () => {
  it("clears 2FA, recovery codes and sessions; only administrators can do it", async () => {
    const { db, u, adminU } = await setup();
    await enroll(db, u.id);
    const { token } = await createSession(db, u.id);
    const sellerU: SessionUser = { id: u.id, nome: u.nome, email: u.email, perfil: "vendedor", podeVerCusto: false };
    await expect(resetUserMfa(db, sellerU, u.id)).rejects.toThrow(ForbiddenError);

    await resetUserMfa(db, adminU, u.id);
    const row = (await db.select().from(usuarios).where(eq(usuarios.id, u.id)).get())!;
    expect(row).toMatchObject({ totpAtivo: false, totpSegredoCifrado: null, totpUltimoPasso: null });
    expect(await remainingRecoveryCodes(db, u.id)).toBe(0);
    expect(await validateSession(db, token)).toBeNull();
    const c = await createChallenge(db, u.id, at(300));
    expect(await prepareEnrollment(db, KEY, c.token, at(300))).not.toBeNull(); // pode configurar de novo
  });
});
