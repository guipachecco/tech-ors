import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { createSession, validateSession } from "@/modules/auth/sessions";
import { verifyPassword } from "@/modules/auth/password";
import { usuarios } from "@/infra/db/schema";
import { createUser, listUsers, resetPassword, updateUserAccess } from "@/modules/users/service";
import { ValidationError } from "@/infra/validation";
import { createTestDb } from "../../helpers/testDb";

function setup() {
  const db = createTestDb();
  const a = db.insert(usuarios).values({ nome: "Adm", email: "adm@x.com", senhaHash: "h", perfil: "administrador", podeVerCusto: true }).returning().get();
  const admin: SessionUser = { id: a.id, nome: a.nome, email: a.email, perfil: a.perfil, podeVerCusto: true };
  return { db, admin };
}

describe("users", () => {
  it("creates users, never exposing the password hash, and rejects duplicates and weak passwords", async () => {
    const { db, admin } = setup();
    const u = await createUser(db, admin, { nome: "Ven", email: "VEN@x.com", senha: "senha-bem-forte", perfil: "vendedor", podeVerCusto: false });
    expect(u.email).toBe("ven@x.com");
    expect("senhaHash" in u).toBe(false);
    expect(listUsers(db, admin).every((x) => !("senhaHash" in x))).toBe(true);
    await expect(createUser(db, admin, { nome: "X", email: "ven@x.com", senha: "senha-bem-forte", perfil: "vendedor", podeVerCusto: false })).rejects.toThrow(ValidationError);
    await expect(createUser(db, admin, { nome: "X", email: "y@x.com", senha: "curta", perfil: "vendedor", podeVerCusto: false })).rejects.toThrow(ValidationError);
  });

  it("only administrators manage users", async () => {
    const { db, admin } = setup();
    const u = await createUser(db, admin, { nome: "Ven", email: "ven@x.com", senha: "senha-bem-forte", perfil: "vendedor", podeVerCusto: true });
    const seller: SessionUser = { id: u.id, nome: u.nome, email: u.email, perfil: "vendedor", podeVerCusto: true };
    expect(() => listUsers(db, seller)).toThrow(ForbiddenError);
    await expect(createUser(db, seller, { nome: "Z", email: "z@x.com", senha: "senha-bem-forte", perfil: "vendedor", podeVerCusto: false })).rejects.toThrow(ForbiddenError);
  });

  it("deactivating revokes sessions; admins cannot deactivate themselves", async () => {
    const { db, admin } = setup();
    const u = await createUser(db, admin, { nome: "Ven", email: "ven@x.com", senha: "senha-bem-forte", perfil: "vendedor", podeVerCusto: false });
    const { token } = await createSession(db, u.id);
    updateUserAccess(db, admin, u.id, { ativo: false });
    expect(await validateSession(db, token)).toBeNull();
    expect(() => updateUserAccess(db, admin, admin.id, { ativo: false })).toThrow(ValidationError);
  });

  it("resets the password and revokes sessions", async () => {
    const { db, admin } = setup();
    const u = await createUser(db, admin, { nome: "Ven", email: "ven@x.com", senha: "senha-bem-forte", perfil: "vendedor", podeVerCusto: false });
    const { token } = await createSession(db, u.id);
    await resetPassword(db, admin, u.id, "outra-senha-forte");
    expect(await validateSession(db, token)).toBeNull();
    const row = db.select().from(usuarios).all().find((x) => x.id === u.id)!;
    expect(await verifyPassword(row.senhaHash, "outra-senha-forte")).toBe(true);
  });
});
