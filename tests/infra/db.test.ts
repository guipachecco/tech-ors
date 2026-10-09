import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { clientes, fornecedores, ofertasCusto, orcamentos, produtos, usuarios } from "@/infra/db/schema";
import { createTestDb } from "../helpers/testDb";

async function seed() {
  const db = await createTestDb();
  const u = await db.insert(usuarios).values({ nome: "A", email: "a@x.com", senhaHash: "h", perfil: "administrador" }).returning().get();
  const c = await db.insert(clientes).values({ razaoSocial: "Cliente", busca: "cliente" }).returning().get();
  return { db, u, c };
}

describe("schema", () => {
  it("rejects duplicate quote numbers", async () => {
    const { db, u, c } = await seed();
    const row = { numero: "2026-0001", clienteId: c.id, validoAte: new Date(), criadoPor: u.id };
    await db.insert(orcamentos).values(row).run();
    await expect(db.insert(orcamentos).values(row).run()).rejects.toThrow();
  });

  it("blocks deleting a supplier that has cost offers", async () => {
    const { db, u } = await seed();
    const f = await db.insert(fornecedores).values({ nome: "F" }).returning().get();
    const p = await db
      .insert(produtos)
      .values({ sku: "S1", fabricante: "X", modelo: "M", categoria: "C", busca: "s1 x m c" })
      .returning()
      .get();
    await db.insert(ofertasCusto)
      .values({ produtoId: p.id, fornecedorId: f.id, custoCentavos: 100, obtidoEm: new Date(), validoAte: new Date(), criadoPor: u.id })
      .run();
    await expect(db.delete(fornecedores).where(eq(fornecedores.id, f.id)).run()).rejects.toThrow();
  });

  it("creates the singleton settings row", async () => {
    const { db } = await seed();
    expect((await db.query.configuracao.findFirst())?.validadeCustoDiasPadrao).toBe(7);
  });
});
