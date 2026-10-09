import { describe, expect, it } from "vitest";
import { isValidCnpj } from "@/domain/cnpj";
import { saveClient, searchClients } from "@/server/clients";
import type { SessionUser } from "@/server/auth/sessions";
import { ValidationError } from "@/server/validation";
import { usuarios } from "@/server/db/schema";
import { createTestDb } from "./helpers/testDb";

function setup() {
  const db = createTestDb();
  const u = db.insert(usuarios).values({ nome: "A", email: "a@x.com", senhaHash: "h", perfil: "administrador" }).returning().get();
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
  it("rejects invalid CNPJ and e-mail", () => {
    const { db, user } = setup();
    expect(() => saveClient(db, user, { razaoSocial: "X", cnpj: "11.222.333/0001-82" })).toThrow(ValidationError);
    expect(() => saveClient(db, user, { razaoSocial: "X", email: "sem-arroba" })).toThrow(ValidationError);
  });
  it("stores digits only and searches ignoring accents", () => {
    const { db, user } = setup();
    const c = saveClient(db, user, { razaoSocial: "Indústria São João Ltda", cnpj: "11.222.333/0001-81" });
    expect(c.cnpj).toBe("11222333000181");
    expect(searchClients(db, "industria sao").map((x) => x.id)).toEqual([c.id]);
    expect(searchClients(db, "inexistente")).toHaveLength(0);
  });
});
