import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { clientes, fornecedores, ofertasCusto, orcamentos, produtos, usuarios } from "@/server/db/schema";
import { createTestDb } from "./helpers/testDb";

function seed() {
  const db = createTestDb();
  const u = db.insert(usuarios).values({ nome: "A", email: "a@x.com", senhaHash: "h", perfil: "administrador" }).returning().get();
  const c = db.insert(clientes).values({ razaoSocial: "Cliente", busca: "cliente" }).returning().get();
  return { db, u, c };
}

describe("schema", () => {
  it("rejects duplicate quote numbers", () => {
    const { db, u, c } = seed();
    const row = { numero: "2026-0001", clienteId: c.id, validoAte: new Date(), criadoPor: u.id };
    db.insert(orcamentos).values(row).run();
    expect(() => db.insert(orcamentos).values(row).run()).toThrow();
  });

  it("blocks deleting a supplier that has cost offers", () => {
    const { db, u } = seed();
    const f = db.insert(fornecedores).values({ nome: "F" }).returning().get();
    const p = db
      .insert(produtos)
      .values({ sku: "S1", fabricante: "X", modelo: "M", categoria: "C", busca: "s1 x m c" })
      .returning()
      .get();
    db.insert(ofertasCusto)
      .values({ produtoId: p.id, fornecedorId: f.id, custoCentavos: 100, obtidoEm: new Date(), validoAte: new Date(), criadoPor: u.id })
      .run();
    expect(() => db.delete(fornecedores).where(eq(fornecedores.id, f.id)).run()).toThrow();
  });

  it("creates the singleton settings row", () => {
    const { db } = seed();
    expect(db.query.configuracao.findFirst().sync()?.validadeCustoDiasPadrao).toBe(7);
  });
});
