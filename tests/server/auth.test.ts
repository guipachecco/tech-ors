import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import { createSession, revokeSession, validateSession } from "@/server/auth/sessions";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/server/auth/throttle";
import { sessoes, usuarios } from "@/server/db/schema";
import { createTestDb } from "./helpers/testDb";

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

function setup() {
  const db = createTestDb();
  const u = db
    .insert(usuarios)
    .values({ nome: "Ana", email: "ana@x.com", senhaHash: "h", perfil: "vendedor", podeVerCusto: true })
    .returning()
    .get();
  return { db, u };
}

describe("sessions", () => {
  it("stores only a hash and validates the token", async () => {
    const { db, u } = setup();
    const { token } = await createSession(db, u.id);
    expect(token.length).toBeGreaterThanOrEqual(43);
    const rows = db.select().from(sessoes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(token);
    const user = await validateSession(db, token);
    expect(user).toMatchObject({ id: u.id, email: "ana@x.com", perfil: "vendedor", podeVerCusto: true });
  });

  it("expires after 12 hours and can be revoked", async () => {
    const { db, u } = setup();
    const t0 = new Date("2026-10-09T10:00:00Z");
    const { token } = await createSession(db, u.id, t0);
    expect(await validateSession(db, token, new Date(t0.getTime() + 11 * 3600_000))).not.toBeNull();
    expect(await validateSession(db, token, new Date(t0.getTime() + 12 * 3600_000))).toBeNull();
    const second = await createSession(db, u.id, t0);
    await revokeSession(db, second.token);
    expect(await validateSession(db, second.token, t0)).toBeNull();
  });

  it("rejects inactive users and unknown tokens", async () => {
    const { db, u } = setup();
    const { token } = await createSession(db, u.id);
    db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, u.id)).run();
    expect(await validateSession(db, token)).toBeNull();
    expect(await validateSession(db, "nao-existe")).toBeNull();
  });
});

describe("login throttle", () => {
  it("blocks after 5 failures for 15 minutes", () => {
    const key = "email:t1@x.com";
    const t0 = new Date("2026-10-09T10:00:00Z");
    for (let i = 0; i < 4; i++) recordLoginFailure(key, t0);
    expect(checkLoginAllowed(key, t0).allowed).toBe(true);
    recordLoginFailure(key, t0);
    const blocked = checkLoginAllowed(key, t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(checkLoginAllowed(key, new Date(t0.getTime() + 15 * 60_000)).allowed).toBe(true);
  });

  it("clears on success", () => {
    const key = "email:t2@x.com";
    for (let i = 0; i < 5; i++) recordLoginFailure(key);
    clearLoginFailures(key);
    expect(checkLoginAllowed(key).allowed).toBe(true);
  });
});
