import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/sessions";
import { addCostOffer, listOffersForProduct } from "@/server/catalog/offers";
import { saveProduct, searchProducts, getProductView } from "@/server/catalog/products";
import { saveMarginRule } from "@/server/catalog/margins";
import { saveSettings, getSettings } from "@/server/catalog/settings";
import { saveSupplier } from "@/server/catalog/suppliers";
import { usuarios, ofertasCusto } from "@/server/db/schema";
import { ValidationError } from "@/server/validation";
import { createTestDb } from "./helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;

function setup() {
  const db = createTestDb();
  const admin = db.insert(usuarios).values({ nome: "Adm", email: "adm@x.com", senhaHash: "h", perfil: "administrador", podeVerCusto: true }).returning().get();
  const seller = db.insert(usuarios).values({ nome: "Ven", email: "ven@x.com", senhaHash: "h", perfil: "vendedor", podeVerCusto: false }).returning().get();
  const toUser = (u: typeof admin): SessionUser => ({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, podeVerCusto: u.podeVerCusto });
  const adminU = toUser(admin);
  const sellerU = toUser(seller);
  const supplier = saveSupplier(db, adminU, { nome: "Forn A" });
  const product = saveProduct(db, adminU, { sku: "NB-1500", fabricante: "SMS", modelo: "Manager III 1500VA", categoria: "Nobreak", descricao: "Nobreak senoidal" });
  return { db, adminU, sellerU, supplier, product };
}

describe("search", () => {
  it("ignores case and accents and requires all terms", () => {
    const { db, adminU } = setup();
    expect(searchProducts(db, adminU, "NOBREAK 1500va").map((p) => p.sku)).toEqual(["NB-1500"]);
    expect(searchProducts(db, adminU, "nobréak sms")).toHaveLength(1);
    expect(searchProducts(db, adminU, "nobreak switch")).toHaveLength(0);
  });
  it("rejects duplicate SKUs", () => {
    const { db, adminU } = setup();
    expect(() => saveProduct(db, adminU, { sku: "NB-1500", fabricante: "X", modelo: "Y", categoria: "Z" })).toThrow(ValidationError);
  });
});

describe("cost offers", () => {
  it("needs cost:write", () => {
    const { db, sellerU, supplier, product } = setup();
    expect(() => addCostOffer(db, sellerU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW)).toThrow(ForbiddenError);
  });

  it("keeps history and prices from the cheapest valid offer", () => {
    const { db, adminU, supplier, product } = setup();
    addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 120000 }, NOW);
    addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    expect(db.select().from(ofertasCusto).all()).toHaveLength(2);
    expect(listOffersForProduct(db, adminU, product.id)).toHaveLength(2);
    const v = getProductView(db, adminU, product.id, NOW);
    expect(v.statusCusto).toBe("valido");
    expect(v.precoVendaCentavos).toBe(125000); // margem padrão 20%, impostos 0
    expect(v.custo?.custoCentavos).toBe(100000);
  });

  it("uses the category validity to prefill the expiry", () => {
    const { db, adminU, supplier, product } = setup();
    saveMarginRule(db, adminU, { escopo: "categoria", chave: "nobreak", margemBps: 2500, margemMinimaBps: 1500, validadeCustoDias: 3 });
    const o = addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    expect(o.validoAte.getTime()).toBe(NOW.getTime() + 3 * DAY);
  });

  it("marks expired and missing costs without a price", () => {
    const { db, adminU, supplier, product } = setup();
    expect(getProductView(db, adminU, product.id, NOW)).toMatchObject({ statusCusto: "sem_preco", precoVendaCentavos: null });
    addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    const later = new Date(NOW.getTime() + 8 * DAY);
    expect(getProductView(db, adminU, product.id, later)).toMatchObject({ statusCusto: "vencido", precoVendaCentavos: null });
  });

  it("rejects javascript: links and non-positive costs", () => {
    const { db, adminU, supplier, product } = setup();
    expect(() => addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 1000, urlProduto: "javascript:alert(1)" }, NOW)).toThrow(ValidationError);
    expect(() => addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 0 }, NOW)).toThrow(ValidationError);
  });
});

describe("cost visibility", () => {
  it("never includes cost or margin keys for a seller without permission", () => {
    const { db, adminU, sellerU, supplier, product } = setup();
    addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    const v = getProductView(db, sellerU, product.id, NOW);
    expect(v.precoVendaCentavos).toBe(125000);
    expect("custo" in v).toBe(false);
    expect("margemBps" in v).toBe(false);
    expect("margemMinimaBps" in v).toBe(false);
    expect(JSON.stringify(v)).not.toContain("100000");
    expect(() => listOffersForProduct(db, sellerU, product.id)).toThrow(ForbiddenError);
  });
});

describe("margin rules and settings", () => {
  it("maker rule beats category rule, which beats the default", () => {
    const { db, adminU, supplier, product } = setup();
    addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    saveMarginRule(db, adminU, { escopo: "categoria", chave: "Nobreak", margemBps: 3000, margemMinimaBps: 1000 });
    expect(getProductView(db, adminU, product.id, NOW).precoVendaCentavos).toBe(142858);
    saveMarginRule(db, adminU, { escopo: "fabricante", chave: "sms", margemBps: 4000, margemMinimaBps: 2000 });
    expect(getProductView(db, adminU, product.id, NOW).precoVendaCentavos).toBe(166667);
  });

  it("applies the tax percentage from settings", () => {
    const { db, adminU, supplier, product } = setup();
    addCostOffer(db, adminU, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
    saveSettings(db, adminU, { ...getSettings(db), impostosBps: 1000 });
    expect(getProductView(db, adminU, product.id, NOW).precoVendaCentavos).toBe(142858);
  });

  it("only administrators manage rules and settings", () => {
    const { db, sellerU } = setup();
    expect(() => saveMarginRule(db, sellerU, { escopo: "categoria", chave: "x", margemBps: 1000, margemMinimaBps: 500 })).toThrow(ForbiddenError);
    expect(() => saveSettings(db, sellerU, getSettings(db))).toThrow(ForbiddenError);
  });
});
