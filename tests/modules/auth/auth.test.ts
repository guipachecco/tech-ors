import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/modules/auth/password";
import { createSession, revokeSession, validateSession } from "@/modules/auth/sessions";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/modules/auth/throttle";
import { sessoes, usuarios } from "@/infra/db/schema";
import { createTestDb } from "../../helpers/testDb";

describe("password", () => {
  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("senha-bem-longa");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "senha-bem-longa")).toBe(true);
    expect(await verifyPassword(h, "outra-senha-aqui")).toBe(false);
  });
  it("rejects short passwords", () => {
    expect(() => validatePasswordStrength("curta")).toThrow();
    expect(() => validatePasswordStrength("1234567890")).not.toThrow();
  });
});

async function setup() {
  const db = await createTestDb();
  const u = await db
    .insert(usuarios)
    .values({ nome: "Ana", email: "ana@x.com", senhaHash: "h", perfil: "vendedor", podeVerCusto: true })
    .returning()
    .get();
  return { db, u };
}

describe("sessions", () => {
  it("stores only a hash and validates the token", async () => {
    const { db, u } = await setup();
    const { token } = await createSession(db, u.id);
    expect(token.length).toBeGreaterThanOrEqual(43);
    const rows = await db.select().from(sessoes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(token);
    const user = await validateSession(db, token);
    expect(user).toMatchObject({ id: u.id, email: "ana@x.com", perfil: "vendedor", podeVerCusto: true });
  });

  it("expires after 12 hours and can be revoked", async () => {
    const { db, u } = await setup();
    const t0 = new Date("2026-10-09T10:00:00Z");
    const { token } = await createSession(db, u.id, t0);
    expect(await validateSession(db, token, new Date(t0.getTime() + 11 * 3600_000))).not.toBeNull();
    expect(await validateSession(db, token, new Date(t0.getTime() + 12 * 3600_000))).toBeNull();
    const second = await createSession(db, u.id, t0);
    await revokeSession(db, second.token);
    expect(await validateSession(db, second.token, t0)).toBeNull();
  });

  it("rejects inactive users and unknown tokens", async () => {
    const { db, u } = await setup();
    const { token } = await createSession(db, u.id);
    await db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, u.id)).run();
    expect(await validateSession(db, token)).toBeNull();
    expect(await validateSession(db, "nao-existe")).toBeNull();
  });
});

describe("login throttle (no banco)", () => {
  const t0 = new Date("2026-10-09T10:00:00Z");

  it("blocks after 5 failures for 15 minutes", async () => {
    const db = await createTestDb();
    const key = "email:t1@x.com";
    for (let i = 0; i < 4; i++) await recordLoginFailure(db, key, t0);
    expect((await checkLoginAllowed(db, key, t0)).allowed).toBe(true);
    await recordLoginFailure(db, key, t0);
    const blocked = await checkLoginAllowed(db, key, t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await checkLoginAllowed(db, key, new Date(t0.getTime() + 15 * 60_000))).allowed).toBe(true);
  });

  it("cannot be bypassed with simultaneous attempts (atomic counting)", async () => {
    const db = await createTestDb();
    const key = "ip:1.2.3.4";
    await Promise.all(Array.from({ length: 12 }, () => recordLoginFailure(db, key, t0)));
    expect((await checkLoginAllowed(db, key, t0)).allowed).toBe(false);
  });

  it("starts a new window after 15 minutes without blocking", async () => {
    const db = await createTestDb();
    const key = "email:t3@x.com";
    for (let i = 0; i < 4; i++) await recordLoginFailure(db, key, t0);
    const later = new Date(t0.getTime() + 16 * 60_000);
    await recordLoginFailure(db, key, later); // janela anterior expirou: conta como 1ª falha
    expect((await checkLoginAllowed(db, key, later)).allowed).toBe(true);
  });

  it("keeps keys independent and clears on success", async () => {
    const db = await createTestDb();
    for (let i = 0; i < 5; i++) await recordLoginFailure(db, "email:a@x.com", t0);
    expect((await checkLoginAllowed(db, "email:b@x.com", t0)).allowed).toBe(true);
    await clearLoginFailures(db, "email:a@x.com");
    expect((await checkLoginAllowed(db, "email:a@x.com", t0)).allowed).toBe(true);
  });
});
