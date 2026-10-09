import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/sessions";
import { addCostOffer } from "@/server/catalog/offers";
import { saveProduct } from "@/server/catalog/products";
import { saveSupplier } from "@/server/catalog/suppliers";
import { saveClient } from "@/server/clients";
import { auditoria, ofertasCusto, usuarios } from "@/server/db/schema";
import { InvalidTransitionError, NoValidCostError, QuoteLockedError, SendBlockedError } from "@/server/quotes/errors";
import { quoteTotals } from "@/server/quotes/guard";
import {
  addProductItem, addServiceItem, createQuote, duplicateQuote, expireOverdueQuotes, getItems, getQuote,
  quoteDrift, removeItem, repriceItem, sendQuote, setFrete, setOutcome, updateItem,
} from "@/server/quotes/service";
import { toClientView, toItemViews } from "@/server/quotes/views";
import { createTestDb } from "./helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;

function setup() {
  const db = createTestDb();
  const mk = (nome: string, perfil: "administrador" | "vendedor", podeVerCusto: boolean): SessionUser => {
    const u = db.insert(usuarios).values({ nome, email: `${nome}@x.com`, senhaHash: "h", perfil, podeVerCusto }).returning().get();
    return { id: u.id, nome, email: u.email, perfil, podeVerCusto };
  };
  const admin = mk("adm", "administrador", true);
  const seller = mk("ven", "vendedor", false);
  const supplier = saveSupplier(db, admin, { nome: "F" });
  const client = saveClient(db, admin, { razaoSocial: "Cliente =HYPERLINK(\"x\")" });
  const product = saveProduct(db, admin, { sku: "NB1", fabricante: "SMS", modelo: "Nobreak 1500", categoria: "Nobreak", descricao: "senoidal" });
  addCostOffer(db, admin, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
  return { db, admin, seller, supplier, client, product };
}

describe("numbering", () => {
  it("is sequential per year", () => {
    const { db, admin, client } = setup();
    expect(createQuote(db, admin, client.id, NOW).numero).toBe("2026-0001");
    expect(createQuote(db, admin, client.id, NOW).numero).toBe("2026-0002");
    expect(createQuote(db, admin, client.id, new Date("2027-01-05T12:00:00Z")).numero).toBe("2027-0001");
  });
});

describe("items and snapshot", () => {
  it("freezes cost, margin and price; later catalog changes do not alter the item", () => {
    const { db, admin, supplier, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    const it = addProductItem(db, admin, q.id, product.id, 2, NOW);
    expect(it).toMatchObject({ custoCentavos: 100000, margemBps: 2000, precoUnitarioCentavos: 125000, quantidade: 2 });
    addCostOffer(db, admin, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 50000 }, NOW);
    expect(getItems(db, q.id)[0].precoUnitarioCentavos).toBe(125000);
    expect(quoteDrift(db, admin, q.id, NOW)).toEqual([
      { itemId: it.id, descricao: it.descricao, custoCongeladoCentavos: 100000, custoAtualCentavos: 50000 },
    ]);
    expect(repriceItem(db, admin, it.id, NOW).precoUnitarioCentavos).toBe(62500);
  });

  it("refuses products without a valid cost", () => {
    const { db, admin, client } = setup();
    const bare = saveProduct(db, admin, { sku: "X", fabricante: "A", modelo: "B", categoria: "C" });
    const q = createQuote(db, admin, client.id, NOW);
    expect(() => addProductItem(db, admin, q.id, bare.id, 1, NOW)).toThrow(NoValidCostError);
    expect(getItems(db, q.id)).toHaveLength(0);
    const expired = new Date(NOW.getTime() + 30 * DAY);
    const ok = saveProduct(db, admin, { sku: "Y", fabricante: "A", modelo: "B", categoria: "C" });
    expect(() => addProductItem(db, admin, q.id, ok.id, 1, expired)).toThrow(NoValidCostError);
  });

  it("computes totals with discount and freight", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    const it = addProductItem(db, admin, q.id, product.id, 3, NOW);
    updateItem(db, admin, it.id, { descontoBps: 500 });
    setFrete(db, admin, q.id, 5000);
    expect(quoteTotals(getQuote(db, q.id), getItems(db, q.id))).toEqual({
      subtotalCentavos: 375000, descontoCentavos: 18750, freteCentavos: 5000, totalCentavos: 361250,
    });
  });

  it("only edits quotes in elaboration", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    const it = addProductItem(db, admin, q.id, product.id, 1, NOW);
    sendQuote(db, admin, q.id, {}, NOW);
    expect(() => updateItem(db, admin, it.id, { quantidade: 5 })).toThrow(QuoteLockedError);
    expect(() => removeItem(db, admin, it.id)).toThrow(QuoteLockedError);
    expect(() => addServiceItem(db, admin, q.id, { descricao: "x", quantidade: 1, precoUnitarioCentavos: 1 })).toThrow(QuoteLockedError);
  });
});

describe("sending", () => {
  it("blocks empty quotes", () => {
    const { db, admin, client } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    expect(() => sendQuote(db, admin, q.id, {}, NOW)).toThrow(SendBlockedError);
  });

  it("sends once; a second send fails and audit has a single entry", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, q.id, product.id, 1, NOW);
    expect(sendQuote(db, admin, q.id, {}, NOW).status).toBe("enviado");
    expect(() => sendQuote(db, admin, q.id, {}, NOW)).toThrow(InvalidTransitionError);
    expect(db.select().from(auditoria).all().filter((a) => a.acao === "orcamento.enviar")).toHaveLength(1);
  });

  it("blocks 100% discount (margin below minimum) unless an admin justifies", () => {
    const { db, admin, seller, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    const it = addProductItem(db, admin, q.id, product.id, 1, NOW);
    updateItem(db, seller, it.id, { descontoBps: 10000 });
    expect(() => sendQuote(db, seller, q.id, { justificativa: "cliente VIP" }, NOW)).toThrow(SendBlockedError);
    expect(() => sendQuote(db, admin, q.id, {}, NOW)).toThrow(SendBlockedError);
    const sent = sendQuote(db, admin, q.id, { justificativa: "cliente estratégico" }, NOW);
    expect(sent.status).toBe("enviado");
    const log = db.select().from(auditoria).all().find((a) => a.acao === "orcamento.enviar")!;
    expect(log.depois).toContain("cliente estratégico");
    expect(log.depois).toContain("margem_abaixo_minimo");
  });

  it("blocks expired frozen costs", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, q.id, product.id, 1, NOW);
    const later = new Date(NOW.getTime() + 8 * DAY); // custo vale 7 dias, proposta 15
    try {
      sendQuote(db, admin, q.id, {}, later);
      expect.unreachable();
    } catch (e) {
      expect((e as SendBlockedError).motivos).toEqual(["custo_vencido"]);
    }
  });

  it("records outcomes and requires a reason to refuse", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, q.id, product.id, 1, NOW);
    expect(() => setOutcome(db, admin, q.id, "aprovado")).toThrow(InvalidTransitionError);
    sendQuote(db, admin, q.id, {}, NOW);
    expect(() => setOutcome(db, admin, q.id, "recusado")).toThrow();
    expect(setOutcome(db, admin, q.id, "recusado", "preço alto").status).toBe("recusado");
  });

  it("expires only overdue sent quotes", () => {
    const { db, admin, client, product } = setup();
    const a = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, a.id, product.id, 1, NOW);
    sendQuote(db, admin, a.id, {}, NOW);
    const b = createQuote(db, admin, client.id, NOW); // em elaboração: não expira
    expect(expireOverdueQuotes(db, new Date(NOW.getTime() + 16 * DAY))).toBe(1);
    expect(getQuote(db, a.id).status).toBe("expirado");
    expect(getQuote(db, b.id).status).toBe("em_elaboracao");
  });
});

describe("duplicate", () => {
  it("copies items into a new draft with a new number", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, q.id, product.id, 2, NOW);
    setFrete(db, admin, q.id, 1234);
    sendQuote(db, admin, q.id, {}, NOW);
    const d = duplicateQuote(db, admin, q.id, NOW);
    expect(d.numero).toBe("2026-0002");
    expect(d.status).toBe("em_elaboracao");
    expect(d.freteCentavos).toBe(1234);
    expect(getItems(db, d.id)).toHaveLength(1);
  });
});

describe("views", () => {
  it("hides cost and margin from sellers without permission", () => {
    const { db, admin, seller, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, q.id, product.id, 1, NOW);
    const [forSeller] = toItemViews(getItems(db, q.id), seller, NOW);
    expect("custoCentavos" in forSeller).toBe(false);
    expect("margemEfetivaBps" in forSeller).toBe(false);
    const [forAdmin] = toItemViews(getItems(db, q.id), admin, NOW);
    expect(forAdmin.custoCentavos).toBe(100000);
    expect(forAdmin.margemEfetivaBps).toBe(2000);
    expect(() => quoteDrift(db, seller, q.id, NOW)).toThrow(ForbiddenError);
  });

  it("client view has no cost or margin keys at any depth", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, q.id, product.id, 1, NOW);
    const view = toClientView(db, getQuote(db, q.id), getItems(db, q.id));
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
      }
    };
    walk(view);
    expect(keys.filter((k) => /custo|margem/i.test(k))).toEqual([]);
    expect(view.totalCentavos).toBe(125000);
    expect(db.select().from(ofertasCusto).all()).toHaveLength(1);
  });
});

describe("item title, specifications and photo", () => {
  it("stores the title and the specifications separately", () => {
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    const it = addProductItem(db, admin, q.id, product.id, 1, NOW);
    expect(it.descricao).toBe("SMS Nobreak 1500");
    expect(it.detalhes).toBe("senoidal");
    const [view] = toItemViews(getItems(db, q.id), admin, NOW);
    expect(view).toMatchObject({ descricao: "SMS Nobreak 1500", detalhes: "senoidal", produtoId: product.id, fotoVersao: null });
  });

  it("carries the product photo into the client view and the screen view", async () => {
    const sharp = (await import("sharp")).default;
    const { saveProductPhoto } = await import("@/server/catalog/photos");
    const { photoVersionsFor } = await import("@/server/quotes/views");
    const { db, admin, client, product } = setup();
    const q = createQuote(db, admin, client.id, NOW);
    addProductItem(db, admin, q.id, product.id, 1, NOW);
    expect(toClientView(db, getQuote(db, q.id), getItems(db, q.id)).itens[0].foto).toBeUndefined();

    await saveProductPhoto(db, admin, product.id, await sharp({ create: { width: 80, height: 60, channels: 3, background: "#123456" } }).png().toBuffer(), NOW);
    const items = getItems(db, q.id);
    const client_ = toClientView(db, getQuote(db, q.id), items);
    expect(Buffer.isBuffer(client_.itens[0].foto)).toBe(true);
    const [view] = toItemViews(items, admin, NOW, photoVersionsFor(db, items));
    expect(view.fotoVersao).toBe(NOW.getTime());
  });
});
