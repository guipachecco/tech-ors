import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { addCostOffer, listOffersForProduct } from "@/modules/catalog/costs/service";
import { saveProduct, searchProducts, getProductView } from "@/modules/catalog/products/service";
import { saveMarginRule } from "@/modules/catalog/margins/service";
import { saveSettings, getSettings } from "@/modules/catalog/settings/service";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import { usuarios, ofertasCusto } from "@/infra/db/schema";
import { ValidationError } from "@/infra/validation";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;

async function setup() {
  const db = await createTestDb();
  const admin = await db.insert(usuarios).values({ nome: "Adm", email: "adm@x.com", senhaHash: "h", perfil: "administrador", podeVerCusto: true }).returning().get();
  const seller = await db.insert(usuarios).values({ nome: "Ven", email: "ven@x.com", senhaHash: "h", perfil: "vendedor", podeVerCusto: false }).returning().get();
  const toUser = (u: typeof admin): SessionUser => ({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, podeVerCusto: u.podeVerCusto });
  const adminU = toUser(admin);
  const sellerU = toUser(seller);
  const supplier = await saveSupplier(db, adminU, { nome: "Forn A" });
  const product = await saveProduct(db, adminU, { sku: "NB-1500", fabricante: "SMS", modelo: "Manager III 1500VA", categoria: "Nobreak", descricao: "Nobreak senoidal" });
  return { db, adminU, sellerU, supplier, product };
}

describe("search", () => {
  it("ignores case and accents and requires all terms", async () => {
    const { db, adminU } = await setup();
    expect((await searchProducts(db, adminU, "NOBREAK 1500va")).map((p) => p.sku)).toEqual(["NB-1500"]);
    expect(await searchProducts(db, adminU, "nobréak sms")).toHaveLength(1);
    expect(await searchProducts(db, adminU, "nobreak switch")).toHaveLength(0);
  });
  it("rejects duplicate SKUs", async () => {
    const { db, adminU } = await setup();
    await expect(saveProduct(db, adminU, { sku: "NB-1500", fabricante: "X", modelo: "Y", categoria: "Z" })).rejects.toThrow(ValidationError);
  });
});

describe("cost offers", () => {
  it("needs cost:write", async () => {
    const { db, sellerU, supplier, product } = await setup();
    await expect(addCostOffer(db, sellerU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW)).rejects.toThrow(ForbiddenError);
  });

  it("keeps history and prices from the cheapest valid offer", async () => {
    const { db, adminU, supplier, product } = await setup();
    await addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 120000 }, NOW);
    await addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    expect(await db.select().from(ofertasCusto).all()).toHaveLength(2);
    expect(await listOffersForProduct(db, adminU, product.id)).toHaveLength(2);
    const v = await getProductView(db, adminU, product.id, NOW);
    expect(v.statusCusto).toBe("valido");
    expect(v.precoVendaCentavos).toBe(125000); // margem padrão 20%, impostos 0
    expect(v.custo?.custoCentavos).toBe(100000);
  });

  it("uses the category validity to prefill the expiry", async () => {
    const { db, adminU, supplier, product } = await setup();
    await saveMarginRule(db, adminU, { escopo: "categoria", chave: "nobreak", margemBps: 2500, margemMinimaBps: 1500, validadeCustoDias: 3 });
    const o = await addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    expect(o.validoAte.getTime()).toBe(NOW.getTime() + 3 * DAY);
  });

  it("marks expired and missing costs without a price", async () => {
    const { db, adminU, supplier, product } = await setup();
    expect(await getProductView(db, adminU, product.id, NOW)).toMatchObject({ statusCusto: "sem_preco", precoVendaCentavos: null });
    await addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    const later = new Date(NOW.getTime() + 8 * DAY);
    expect(await getProductView(db, adminU, product.id, later)).toMatchObject({ statusCusto: "vencido", precoVendaCentavos: null });
  });

  it("rejects javascript: links and non-positive costs", async () => {
    const { db, adminU, supplier, product } = await setup();
    await expect(addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 1000, urlProduto: "javascript:alert(1)" }, NOW)).rejects.toThrow(ValidationError);
    await expect(addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 0 }, NOW)).rejects.toThrow(ValidationError);
  });
});

describe("cost visibility", () => {
  it("never includes cost or margin keys for a seller without permission", async () => {
    const { db, adminU, sellerU, supplier, product } = await setup();
    await addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    const v = await getProductView(db, sellerU, product.id, NOW);
    expect(v.precoVendaCentavos).toBe(125000);
    expect("custo" in v).toBe(false);
    expect("margemBps" in v).toBe(false);
    expect("margemMinimaBps" in v).toBe(false);
    expect(JSON.stringify(v)).not.toContain("100000");
    await expect(listOffersForProduct(db, sellerU, product.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("margin rules and settings", () => {
  it("maker rule beats category rule, which beats the default", async () => {
    const { db, adminU, supplier, product } = await setup();
    await addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    await saveMarginRule(db, adminU, { escopo: "categoria", chave: "Nobreak", margemBps: 3000, margemMinimaBps: 1000 });
    expect((await getProductView(db, adminU, product.id, NOW)).precoVendaCentavos).toBe(142858);
    await saveMarginRule(db, adminU, { escopo: "fabricante", chave: "sms", margemBps: 4000, margemMinimaBps: 2000 });
    expect((await getProductView(db, adminU, product.id, NOW)).precoVendaCentavos).toBe(166667);
  });

  it("applies the tax percentage from settings", async () => {
    const { db, adminU, supplier, product } = await setup();
    await addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    await saveSettings(db, adminU, { ...(await getSettings(db)), impostosBps: 1000 });
    expect((await getProductView(db, adminU, product.id, NOW)).precoVendaCentavos).toBe(142858);
  });

  it("only administrators manage rules and settings", async () => {
    const { db, sellerU } = await setup();
    await expect(saveMarginRule(db, sellerU, { escopo: "categoria", chave: "x", margemBps: 1000, margemMinimaBps: 500 })).rejects.toThrow(ForbiddenError);
    await expect(saveSettings(db, sellerU, await getSettings(db))).rejects.toThrow(ForbiddenError);
  });
});
