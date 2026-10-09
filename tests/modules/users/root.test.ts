import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resetUserMfa } from "@/modules/auth/mfa";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { createSession, validateSession } from "@/modules/auth/sessions";
import { usuarios } from "@/infra/db/schema";
import { createUser, listUsers, resetPassword, updateUserAccess } from "@/modules/users/service";
import { ValidationError } from "@/infra/validation";
import { createTestDb } from "../../helpers/testDb";

function setup() {
  const db = createTestDb();
  const mk = (nome: string, perfil: "root" | "administrador" | "vendedor") => {
    const u = db.insert(usuarios).values({ nome, email: `${nome}@x.com`, senhaHash: "h", perfil, podeVerCusto: perfil !== "vendedor" }).returning().get();
    const s: SessionUser = { id: u.id, nome, email: u.email, perfil, podeVerCusto: u.podeVerCusto };
    return s;
  };
  return { db, root: mk("root", "root"), admin: mk("adm", "administrador"), admin2: mk("adm2", "administrador"), seller: mk("ven", "vendedor") };
}

const NEW = { nome: "Novo", email: "novo@x.com", senha: "senha-bem-forte", podeVerCusto: false };

describe("creating users", () => {
  it("only root creates administrators; administrators create sellers", async () => {
    const { db, root, admin } = setup();
    await expect(createUser(db, admin, { ...NEW, perfil: "administrador" })).rejects.toThrow(ForbiddenError);
    expect((await createUser(db, admin, { ...NEW, perfil: "vendedor" })).perfil).toBe("vendedor");
    expect((await createUser(db, root, { ...NEW, email: "outro@x.com", perfil: "administrador" })).perfil).toBe("administrador");
  });

  it("nobody creates a root through the application (only the server command does)", async () => {
    const { db, root } = setup();
    await expect(createUser(db, root, { ...NEW, perfil: "root" as never })).rejects.toThrow(ValidationError);
  });
});

describe("protecting the root account", () => {
  it("an administrator cannot deactivate, change access, reset password or reset 2FA of root", async () => {
    const { db, root, admin } = setup();
    expect(() => updateUserAccess(db, admin, root.id, { ativo: false })).toThrow(ForbiddenError);
    expect(() => updateUserAccess(db, admin, root.id, { podeVerCusto: false })).toThrow(ForbiddenError);
    await expect(resetPassword(db, admin, root.id, "outra-senha-forte")).rejects.toThrow(ForbiddenError);
    expect(() => resetUserMfa(db, admin, root.id)).toThrow(ForbiddenError);
    const row = db.select().from(usuarios).where(eq(usuarios.id, root.id)).get()!;
    expect(row.ativo).toBe(true);
    expect(row.senhaHash).toBe("h");
  });

  it("not even root can be deactivated through the application", () => {
    const { db, root, admin2 } = setup();
    expect(() => updateUserAccess(db, root, root.id, { ativo: false })).toThrow(ValidationError);
    expect(db.select().from(usuarios).where(eq(usuarios.id, admin2.id)).get()!.ativo).toBe(true);
  });

  it("root manages administrators and sellers; peers administrators still manage each other", async () => {
    const { db, root, admin, admin2, seller } = setup();
    updateUserAccess(db, root, admin.id, { ativo: false });
    expect(db.select().from(usuarios).where(eq(usuarios.id, admin.id)).get()!.ativo).toBe(false);
    updateUserAccess(db, admin2, seller.id, { podeVerCusto: true });
    await resetPassword(db, root, admin2.id, "outra-senha-forte");
  });

  it("deactivating a user revokes sessions, and root can reset its own password", async () => {
    const { db, root, seller } = setup();
    const { token } = await createSession(db, seller.id);
    updateUserAccess(db, root, seller.id, { ativo: false });
    expect(await validateSession(db, token)).toBeNull();
    await expect(resetPassword(db, root, root.id, "nova-senha-forte")).resolves.toBeUndefined();
  });

  it("lists root with its profile for the admin screen", () => {
    const { db, admin } = setup();
    expect(listUsers(db, admin).map((u) => u.perfil)).toContain("root");
  });
});
