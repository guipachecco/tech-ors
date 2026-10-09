import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { addCostOffer } from "@/modules/catalog/costs/service";
import { saveProduct } from "@/modules/catalog/products/service";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import { saveClient } from "@/modules/clients/service";
import { auditoria, ofertasCusto, usuarios } from "@/infra/db/schema";
import { InvalidTransitionError, NoValidCostError, QuoteLockedError, SendBlockedError } from "@/modules/quotes/errors";
import { quoteTotals } from "@/modules/quotes/guard";
import {
  addProductItem, addServiceItem, createQuote, duplicateQuote, expireOverdueQuotes, getItems, getQuote,
  quoteDrift, removeItem, repriceItem, sendQuote, setFrete, setOutcome, updateItem,
} from "@/modules/quotes/service";
import { toClientView, toItemViews } from "@/modules/quotes/views";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;

async function setup() {
  const db = await createTestDb();
  const mk = async (nome: string, perfil: "administrador" | "vendedor", podeVerCusto: boolean): Promise<SessionUser> => {
    const u = await db.insert(usuarios).values({ nome, email: `${nome}@x.com`, senhaHash: "h", perfil, podeVerCusto }).returning().get();
    return { id: u.id, nome, email: u.email, perfil, podeVerCusto };
  };
  const admin = await mk("adm", "administrador", true);
  const seller = await mk("ven", "vendedor", false);
  const supplier = await saveSupplier(db, admin, { nome: "F" });
  const client = await saveClient(db, admin, { razaoSocial: "Cliente =HYPERLINK(\"x\")" });
  const product = await saveProduct(db, admin, { sku: "NB1", fabricante: "SMS", modelo: "Nobreak 1500", categoria: "Nobreak", descricao: "senoidal" });
  await addCostOffer(db, admin, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100000 }, NOW);
  return { db, admin, seller, supplier, client, product };
}

describe("numbering", () => {
  it("is sequential per year", async () => {
    const { db, admin, client } = await setup();
    expect((await createQuote(db, admin, client.id, NOW)).numero).toBe("2026-0001");
    expect((await createQuote(db, admin, client.id, NOW)).numero).toBe("2026-0002");
    expect((await createQuote(db, admin, client.id, new Date("2027-01-05T12:00:00Z"))).numero).toBe("2027-0001");
  });
});

describe("items and snapshot", () => {
  it("freezes cost, margin and price; later catalog changes do not alter the item", async () => {
    const { db, admin, supplier, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    const it = await addProductItem(db, admin, q.id, product.id, 2, NOW);
    expect(it).toMatchObject({ custoCentavos: 100000, margemBps: 2000, precoUnitarioCentavos: 125000, quantidade: 2 });
    await addCostOffer(db, admin, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 50000 }, NOW);
    expect((await getItems(db, q.id))[0].precoUnitarioCentavos).toBe(125000);
    expect(await quoteDrift(db, admin, q.id, NOW)).toEqual([
      { itemId: it.id, descricao: it.descricao, custoCongeladoCentavos: 100000, custoAtualCentavos: 50000 },
    ]);
    expect((await repriceItem(db, admin, it.id, NOW)).precoUnitarioCentavos).toBe(62500);
  });

  it("refuses products without a valid cost", async () => {
    const { db, admin, client } = await setup();
    const bare = await saveProduct(db, admin, { sku: "X", fabricante: "A", modelo: "B", categoria: "C" });
    const q = await createQuote(db, admin, client.id, NOW);
    await expect(addProductItem(db, admin, q.id, bare.id, 1, NOW)).rejects.toThrow(NoValidCostError);
    expect(await getItems(db, q.id)).toHaveLength(0);
    const expired = new Date(NOW.getTime() + 30 * DAY);
    const ok = await saveProduct(db, admin, { sku: "Y", fabricante: "A", modelo: "B", categoria: "C" });
    await expect(addProductItem(db, admin, q.id, ok.id, 1, expired)).rejects.toThrow(NoValidCostError);
  });

  it("computes totals with discount and freight", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    const it = await addProductItem(db, admin, q.id, product.id, 3, NOW);
    await updateItem(db, admin, it.id, { descontoBps: 500 });
    await setFrete(db, admin, q.id, 5000);
    expect(quoteTotals(await getQuote(db, q.id), await getItems(db, q.id))).toEqual({
      subtotalCentavos: 375000, descontoCentavos: 18750, freteCentavos: 5000, totalCentavos: 361250,
    });
  });

  it("only edits quotes in elaboration", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    const it = await addProductItem(db, admin, q.id, product.id, 1, NOW);
    await sendQuote(db, admin, q.id, {}, NOW);
    await expect(updateItem(db, admin, it.id, { quantidade: 5 })).rejects.toThrow(QuoteLockedError);
    await expect(removeItem(db, admin, it.id)).rejects.toThrow(QuoteLockedError);
    await expect(addServiceItem(db, admin, q.id, { descricao: "x", quantidade: 1, precoUnitarioCentavos: 1 })).rejects.toThrow(QuoteLockedError);
  });
});

describe("sending", () => {
  it("blocks empty quotes", async () => {
    const { db, admin, client } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await expect(sendQuote(db, admin, q.id, {}, NOW)).rejects.toThrow(SendBlockedError);
  });

  it("sends once; a second send fails and audit has a single entry", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, q.id, product.id, 1, NOW);
    expect((await sendQuote(db, admin, q.id, {}, NOW)).status).toBe("enviado");
    await expect(sendQuote(db, admin, q.id, {}, NOW)).rejects.toThrow(InvalidTransitionError);
    expect((await db.select().from(auditoria).all()).filter((a) => a.acao === "orcamento.enviar")).toHaveLength(1);
  });

  it("blocks 100% discount (margin below minimum) unless an admin justifies", async () => {
    const { db, admin, seller, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    const it = await addProductItem(db, admin, q.id, product.id, 1, NOW);
    await updateItem(db, seller, it.id, { descontoBps: 10000 });
    await expect(sendQuote(db, seller, q.id, { justificativa: "cliente VIP" }, NOW)).rejects.toThrow(SendBlockedError);
    await expect(sendQuote(db, admin, q.id, {}, NOW)).rejects.toThrow(SendBlockedError);
    const sent = await sendQuote(db, admin, q.id, { justificativa: "cliente estratégico" }, NOW);
    expect(sent.status).toBe("enviado");
    const log = (await db.select().from(auditoria).all()).find((a) => a.acao === "orcamento.enviar")!;
    expect(log.depois).toContain("cliente estratégico");
    expect(log.depois).toContain("margem_abaixo_minimo");
  });

  it("blocks expired frozen costs", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, q.id, product.id, 1, NOW);
    const later = new Date(NOW.getTime() + 8 * DAY); // custo vale 7 dias, proposta 15
    try {
      await sendQuote(db, admin, q.id, {}, later);
      expect.unreachable();
    } catch (e) {
      expect((e as SendBlockedError).motivos).toEqual(["custo_vencido"]);
    }
  });

  it("records outcomes and requires a reason to refuse", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, q.id, product.id, 1, NOW);
    await expect(setOutcome(db, admin, q.id, "aprovado")).rejects.toThrow(InvalidTransitionError);
    await sendQuote(db, admin, q.id, {}, NOW);
    await expect(setOutcome(db, admin, q.id, "recusado")).rejects.toThrow();
    expect((await setOutcome(db, admin, q.id, "recusado", "preço alto")).status).toBe("recusado");
  });

  it("expires only overdue sent quotes", async () => {
    const { db, admin, client, product } = await setup();
    const a = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, a.id, product.id, 1, NOW);
    await sendQuote(db, admin, a.id, {}, NOW);
    const b = await createQuote(db, admin, client.id, NOW); // em elaboração: não expira
    expect(await expireOverdueQuotes(db, new Date(NOW.getTime() + 16 * DAY))).toBe(1);
    expect((await getQuote(db, a.id)).status).toBe("expirado");
    expect((await getQuote(db, b.id)).status).toBe("em_elaboracao");
  });
});

describe("duplicate", () => {
  it("copies items into a new draft with a new number", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, q.id, product.id, 2, NOW);
    await setFrete(db, admin, q.id, 1234);
    await sendQuote(db, admin, q.id, {}, NOW);
    const d = await duplicateQuote(db, admin, q.id, NOW);
    expect(d.numero).toBe("2026-0002");
    expect(d.status).toBe("em_elaboracao");
    expect(d.freteCentavos).toBe(1234);
    expect(await getItems(db, d.id)).toHaveLength(1);
  });
});

describe("views", () => {
  it("hides cost and margin from sellers without permission", async () => {
    const { db, admin, seller, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, q.id, product.id, 1, NOW);
    const [forSeller] = toItemViews(await getItems(db, q.id), seller, NOW);
    expect("custoCentavos" in forSeller).toBe(false);
    expect("margemEfetivaBps" in forSeller).toBe(false);
    const [forAdmin] = toItemViews(await getItems(db, q.id), admin, NOW);
    expect(forAdmin.custoCentavos).toBe(100000);
    expect(forAdmin.margemEfetivaBps).toBe(2000);
    await expect(quoteDrift(db, seller, q.id, NOW)).rejects.toThrow(ForbiddenError);
  });

  it("client view has no cost or margin keys at any depth", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, q.id, product.id, 1, NOW);
    const view = await toClientView(db, await getQuote(db, q.id), await getItems(db, q.id));
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
      }
    };
    walk(view);
    expect(keys.filter((k) => /custo|margem/i.test(k))).toEqual([]);
    expect(view.totalCentavos).toBe(125000);
    expect(await db.select().from(ofertasCusto).all()).toHaveLength(1);
  });
});

describe("item title, specifications and photo", () => {
  it("stores the title and the specifications separately", async () => {
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    const it = await addProductItem(db, admin, q.id, product.id, 1, NOW);
    expect(it.descricao).toBe("SMS Nobreak 1500");
    expect(it.detalhes).toBe("senoidal");
    const [view] = toItemViews(await getItems(db, q.id), admin, NOW);
    expect(view).toMatchObject({ descricao: "SMS Nobreak 1500", detalhes: "senoidal", produtoId: product.id, fotoVersao: null });
  });

  it("carries the product photo into the client view and the screen view", async () => {
    const sharp = (await import("sharp")).default;
    const { saveProductPhoto } = await import("@/modules/catalog/photos/service");
    const { photoVersionsFor } = await import("@/modules/quotes/views");
    const { db, admin, client, product } = await setup();
    const q = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, q.id, product.id, 1, NOW);
    expect((await toClientView(db, await getQuote(db, q.id), await getItems(db, q.id))).itens[0].foto).toBeUndefined();

    await saveProductPhoto(db, admin, product.id, await sharp({ create: { width: 80, height: 60, channels: 3, background: "#123456" } }).png().toBuffer(), NOW);
    const items = await getItems(db, q.id);
    const client_ = await toClientView(db, await getQuote(db, q.id), items);
    expect(Buffer.isBuffer(client_.itens[0].foto)).toBe(true);
    const [view] = toItemViews(items, admin, NOW, await photoVersionsFor(db, items));
    expect(view.fotoVersao).toBe(NOW.getTime());
  });
});
