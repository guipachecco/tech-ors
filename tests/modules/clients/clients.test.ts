import { describe, expect, it } from "vitest";
import { isValidCnpj } from "@/domain/cnpj";
import { saveClient, searchClients } from "@/modules/clients/service";
import type { SessionUser } from "@/modules/auth/sessions";
import { ValidationError } from "@/infra/validation";
import { usuarios } from "@/infra/db/schema";
import { createTestDb } from "../../helpers/testDb";

async function setup() {
  const db = await createTestDb();
  const u = await db.insert(usuarios).values({ nome: "A", email: "a@x.com", senhaHash: "h", perfil: "administrador" }).returning().get();
  const user: SessionUser = { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, podeVerCusto: true };
  return { db, user };
}

describe("cnpj", () => {
  it("validates check digits", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
});

describe("clients", () => {
  it("rejects invalid CNPJ and e-mail", async () => {
    const { db, user } = await setup();
    await expect(saveClient(db, user, { razaoSocial: "X", cnpj: "11.222.333/0001-82" })).rejects.toThrow(ValidationError);
    await expect(saveClient(db, user, { razaoSocial: "X", email: "sem-arroba" })).rejects.toThrow(ValidationError);
  });
  it("stores digits only and searches ignoring accents", async () => {
    const { db, user } = await setup();
    const c = await saveClient(db, user, { razaoSocial: "Indústria São João Ltda", cnpj: "11.222.333/0001-81" });
    expect(c.cnpj).toBe("11222333000181");
    expect((await searchClients(db, "industria sao")).map((x) => x.id)).toEqual([c.id]);
    expect(await searchClients(db, "inexistente")).toHaveLength(0);
  });
});
