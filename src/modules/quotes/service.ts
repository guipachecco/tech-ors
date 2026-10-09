import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { currentCost, type CostOffer } from "@/domain/costs";
import { salePriceCents } from "@/domain/pricing";
import { canTransition, type QuoteStatus } from "@/domain/quoteStatus";
import { formatQuoteNumber } from "@/domain/quoteNumber";
import { recordAudit } from "@/infra/audit";
import { assertCan, can } from "../auth/permissions";
import type { SessionUser } from "../auth/sessions";
import { resolveRule } from "../catalog/margins/service";
import { getSettings } from "../catalog/settings/service";
import type { Db } from "@/infra/db/client";
import { clientes, ofertasCusto, orcamentoItens, orcamentos, produtos, sequenciaOrcamento } from "@/infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "@/infra/validation";
import { InvalidTransitionError, NoValidCostError, QuoteLockedError, SendBlockedError } from "./errors";
import { checkSendable, OVERRIDABLE, quoteTotals, type Quote, type QuoteItem } from "./guard";

const DAY = 86_400_000;

// ---------- leitura ----------

export async function getQuote(db: Db, id: number): Promise<Quote> {
  const q = await db.select().from(orcamentos).where(eq(orcamentos.id, id)).get();
  if (!q) throw new NotFoundError("Orçamento");
  return q;
}

export async function getItems(db: Db, quoteId: number): Promise<QuoteItem[]> {
  return await db.select().from(orcamentoItens).where(eq(orcamentoItens.orcamentoId, quoteId)).orderBy(orcamentoItens.id).all();
}

export async function listQuotes(db: Db, limit = 200) {
  const rows = await db
    .select({
      id: orcamentos.id,
      numero: orcamentos.numero,
      status: orcamentos.status,
      validoAte: orcamentos.validoAte,
      criadoEm: orcamentos.criadoEm,
      freteCentavos: orcamentos.freteCentavos,
      clienteId: orcamentos.clienteId,
      clienteNome: clientes.razaoSocial,
    })
    .from(orcamentos)
    .innerJoin(clientes, eq(clientes.id, orcamentos.clienteId))
    .orderBy(desc(orcamentos.id))
    .limit(limit)
    .all();

  // Itens de todos os orçamentos listados numa consulta só; o total de cada um é calculado aqui.
  const items = new Map<number, QuoteItem[]>();
  for (let i = 0; i < rows.length; i += 400) {
    const ids = rows.slice(i, i + 400).map((r) => r.id);
    for (const it of await db.select().from(orcamentoItens).where(inArray(orcamentoItens.orcamentoId, ids)).all()) {
      if (!items.has(it.orcamentoId)) items.set(it.orcamentoId, []);
      items.get(it.orcamentoId)!.push(it);
    }
  }
  return rows.map((r) => ({ ...r, totalCentavos: quoteTotals({ freteCentavos: r.freteCentavos }, items.get(r.id) ?? []).totalCentavos }));
}

function assertEditable(q: Quote) {
  if (q.status !== "em_elaboracao") throw new QuoteLockedError();
}

// ---------- criação ----------

async function insertQuote(db: Db, user: SessionUser, clientId: number, now: Date, source?: Quote) {
  const settings = await getSettings(db);
  return await db.transaction(async (tx) => {
    const client = await tx.select().from(clientes).where(eq(clientes.id, clientId)).get();
    if (!client) throw new NotFoundError("Cliente");
    const year = now.getFullYear();
    const seqRow = await tx.select().from(sequenciaOrcamento).where(eq(sequenciaOrcamento.ano, year)).get();
    const seq = (seqRow?.ultimo ?? 0) + 1;
    if (seqRow) await tx.update(sequenciaOrcamento).set({ ultimo: seq }).where(eq(sequenciaOrcamento.ano, year)).run();
    else await tx.insert(sequenciaOrcamento).values({ ano: year, ultimo: seq }).run();

    return await tx
      .insert(orcamentos)
      .values({
        numero: formatQuoteNumber(year, seq),
        clienteId: clientId,
        validoAte: new Date(now.getTime() + settings.validadePropostaDias * DAY),
        condicoesPagamento: source?.condicoesPagamento ?? settings.condicoesPagamento,
        prazoEntrega: source?.prazoEntrega ?? settings.prazoEntrega,
        garantia: source?.garantia ?? settings.garantia,
        observacoes: source?.observacoes ?? settings.observacoesPadrao,
        freteCentavos: source?.freteCentavos ?? 0,
        criadoPor: user.id,
        criadoEm: now,
      })
      .returning()
      .get();
  });
}

export async function createQuote(db: Db, user: SessionUser, clientId: number, now = new Date()): Promise<Quote> {
  const q = await insertQuote(db, user, clientId, now);
  await recordAudit(db, { userId: user.id, acao: "orcamento.criar", entidade: "orcamento", entidadeId: q.id, depois: { numero: q.numero, clienteId: clientId } });
  return q;
}

export async function duplicateQuote(db: Db, user: SessionUser, quoteId: number, now = new Date()): Promise<Quote> {
  const source = await getQuote(db, quoteId);
  const copy = await insertQuote(db, user, source.clienteId, now, source);
  for (const it of await getItems(db, quoteId)) {
    const { id: _id, orcamentoId: _o, ...rest } = it;
    await db.insert(orcamentoItens).values({ ...rest, orcamentoId: copy.id }).run();
  }
  await recordAudit(db, { userId: user.id, acao: "orcamento.duplicar", entidade: "orcamento", entidadeId: copy.id, depois: { numero: copy.numero, origem: source.numero } });
  return copy;
}

// ---------- edição ----------

const detailsSchema = z.object({
  condicoesPagamento: z.string().trim().max(500),
  prazoEntrega: z.string().trim().max(500),
  garantia: z.string().trim().max(500),
  observacoes: z.string().trim().max(2000),
  validoAte: z.date(),
});

export async function updateQuoteDetails(db: Db, user: SessionUser, quoteId: number, input: z.input<typeof detailsSchema>): Promise<Quote> {
  const q = await getQuote(db, quoteId);
  assertEditable(q);
  const data = parseInput(detailsSchema, input);
  const after = await db.update(orcamentos).set(data).where(eq(orcamentos.id, quoteId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.alterar", entidade: "orcamento", entidadeId: quoteId, antes: q, depois: after });
  return after;
}

const qtySchema = z.number().int("Quantidade inteira").min(1, "Mínimo 1").max(100_000);
const discountSchema = z.number().int().min(0).max(10_000, "Desconto acima de 100%");

async function snapshotProduct(db: Db, productId: number, now: Date) {
  const product = await db.select().from(produtos).where(eq(produtos.id, productId)).get();
  if (!product) throw new NotFoundError("Produto");
  const offers = await db.select().from(ofertasCusto).where(eq(ofertasCusto.produtoId, productId)).all();
  const domainOffers: CostOffer[] = offers.map((o) => ({
    id: o.id, supplierId: o.fornecedorId, costCents: o.custoCentavos, obtainedAt: o.obtidoEm, validUntil: o.validoAte,
  }));
  const best = currentCost(domainOffers, now);
  if (!best) throw new NoValidCostError();
  const rule = await resolveRule(db, product);
  const tax = (await getSettings(db)).impostosBps;
  return {
    product,
    values: {
      custoCentavos: best.costCents,
      margemBps: rule.margemBps,
      margemMinimaBps: rule.margemMinimaBps,
      impostosBps: tax,
      precoUnitarioCentavos: salePriceCents(best.costCents, rule.margemBps, tax),
      custoValidoAte: best.validUntil,
      ofertaCustoId: best.id,
    },
  };
}

export async function addProductItem(db: Db, user: SessionUser, quoteId: number, productId: number, qty: number, now = new Date()): Promise<QuoteItem> {
  const q = await getQuote(db, quoteId);
  assertEditable(q);
  const quantidade = parseInput(qtySchema, qty);
  const { product, values } = await snapshotProduct(db, productId, now);
  const descricao = `${product.fabricante} ${product.modelo}`; // título; as especificações vão em `detalhes`
  const item = await db
    .insert(orcamentoItens)
    .values({ orcamentoId: quoteId, tipo: "produto", produtoId: productId, descricao, detalhes: product.descricao, quantidade, ...values })
    .returning()
    .get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_adicionar", entidade: "orcamento", entidadeId: quoteId, depois: { itemId: item.id, produtoId: productId, quantidade } });
  return item;
}

const serviceSchema = z.object({
  descricao: z.string().trim().min(1, "Descreva o serviço").max(300),
  quantidade: qtySchema,
  precoUnitarioCentavos: z.number().int().min(0).max(100_000_000_00),
});

export async function addServiceItem(db: Db, user: SessionUser, quoteId: number, input: z.input<typeof serviceSchema>): Promise<QuoteItem> {
  assertEditable(await getQuote(db, quoteId));
  const data = parseInput(serviceSchema, input);
  const item = await db.insert(orcamentoItens).values({ orcamentoId: quoteId, tipo: "servico", ...data }).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_adicionar", entidade: "orcamento", entidadeId: quoteId, depois: { itemId: item.id, servico: data.descricao } });
  return item;
}

export async function setFrete(db: Db, user: SessionUser, quoteId: number, cents: number): Promise<Quote> {
  assertEditable(await getQuote(db, quoteId));
  const frete = parseInput(z.number().int().min(0).max(100_000_000_00), cents);
  const after = await db.update(orcamentos).set({ freteCentavos: frete }).where(eq(orcamentos.id, quoteId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.frete", entidade: "orcamento", entidadeId: quoteId, depois: { frete } });
  return after;
}

async function itemAndQuote(db: Db, itemId: number) {
  const item = await db.select().from(orcamentoItens).where(eq(orcamentoItens.id, itemId)).get();
  if (!item) throw new NotFoundError("Item");
  const quote = await getQuote(db, item.orcamentoId);
  assertEditable(quote);
  return { item, quote };
}

export async function updateItem(db: Db, user: SessionUser, itemId: number, input: { quantidade?: number; descontoBps?: number }): Promise<QuoteItem> {
  const { item } = await itemAndQuote(db, itemId);
  const patch: { quantidade?: number; descontoBps?: number } = {};
  if (input.quantidade !== undefined) patch.quantidade = parseInput(qtySchema, input.quantidade);
  if (input.descontoBps !== undefined) patch.descontoBps = parseInput(discountSchema, input.descontoBps);
  if (Object.keys(patch).length === 0) throw new ValidationError({ _: "Nada para alterar" });
  const after = await db.update(orcamentoItens).set(patch).where(eq(orcamentoItens.id, itemId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_alterar", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, quantidade: item.quantidade, descontoBps: item.descontoBps }, depois: { itemId, ...patch } });
  return after;
}

export async function removeItem(db: Db, user: SessionUser, itemId: number): Promise<void> {
  const { item } = await itemAndQuote(db, itemId);
  await db.delete(orcamentoItens).where(eq(orcamentoItens.id, itemId)).run();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_remover", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, descricao: item.descricao } });
}

/** Traz custo, margem e preço vigentes do catálogo para o item. */
export async function repriceItem(db: Db, user: SessionUser, itemId: number, now = new Date()): Promise<QuoteItem> {
  const { item } = await itemAndQuote(db, itemId);
  if (item.tipo !== "produto" || item.produtoId === null) throw new ValidationError({ _: "Só produtos podem ser reprecificados" });
  const { values } = await snapshotProduct(db, item.produtoId, now);
  const after = await db.update(orcamentoItens).set(values).where(eq(orcamentoItens.id, itemId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_reprecificar", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, preco: item.precoUnitarioCentavos }, depois: { itemId, preco: after.precoUnitarioCentavos } });
  return after;
}

// ---------- status ----------

export async function sendQuote(db: Db, user: SessionUser, quoteId: number, opts: { justificativa?: string } = {}, now = new Date()): Promise<Quote> {
  return await db.transaction(async (tx) => {
    const q = await tx.select().from(orcamentos).where(eq(orcamentos.id, quoteId)).get();
    if (!q) throw new NotFoundError("Orçamento");
    if (!canTransition(q.status, "enviado")) throw new InvalidTransitionError(q.status, "enviado");
    const items = await tx.select().from(orcamentoItens).where(eq(orcamentoItens.orcamentoId, quoteId)).all();

    const check = checkSendable(q, items, now);
    let overridden: string[] = [];
    if (!check.ok) {
      const hard = check.motivos.filter((m) => !OVERRIDABLE.includes(m));
      if (hard.length > 0) throw new SendBlockedError(check.motivos);
      const justificativa = opts.justificativa?.trim() ?? "";
      if (!can(user, "quote:override")) {
        throw new SendBlockedError(check.motivos, "Envio bloqueado: peça a um administrador para liberar.");
      }
      if (justificativa.length < 5) {
        throw new SendBlockedError(check.motivos, "Informe a justificativa para liberar o envio.");
      }
      overridden = check.motivos;
    }

    const after = await tx.update(orcamentos).set({ status: "enviado", enviadoEm: now }).where(and(eq(orcamentos.id, quoteId), eq(orcamentos.status, "em_elaboracao"))).returning().get();
    if (!after) throw new InvalidTransitionError(q.status, "enviado");
    await recordAudit(tx as unknown as Db, {
      userId: user.id,
      acao: "orcamento.enviar",
      entidade: "orcamento",
      entidadeId: quoteId,
      depois: { numero: q.numero, liberadoPor: overridden.length ? { motivos: overridden, justificativa: opts.justificativa?.trim() } : null },
    });
    return after;
  });
}

export async function setOutcome(db: Db, user: SessionUser, quoteId: number, outcome: "aprovado" | "recusado", motivo?: string): Promise<Quote> {
  const q = await getQuote(db, quoteId);
  if (!canTransition(q.status, outcome)) throw new InvalidTransitionError(q.status, outcome);
  const reason = motivo?.trim() || null;
  if (outcome === "recusado" && !reason) throw new ValidationError({ motivo: "Informe o motivo da recusa" });
  const after = await db.update(orcamentos).set({ status: outcome, motivoResultado: reason }).where(eq(orcamentos.id, quoteId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: `orcamento.${outcome}`, entidade: "orcamento", entidadeId: quoteId, depois: { motivo: reason } });
  return after;
}

export async function expireOverdueQuotes(db: Db, now = new Date()): Promise<number> {
  const overdue = await db.select().from(orcamentos).where(and(eq(orcamentos.status, "enviado"), lte(orcamentos.validoAte, now))).all();
  for (const q of overdue) {
    await db.update(orcamentos).set({ status: "expirado" }).where(eq(orcamentos.id, q.id)).run();
    await recordAudit(db, { userId: null, acao: "orcamento.expirar", entidade: "orcamento", entidadeId: q.id, depois: { numero: q.numero } });
  }
  return overdue.length;
}

// ---------- comparação com o catálogo ----------

export type Drift = { itemId: number; descricao: string; custoCongeladoCentavos: number; custoAtualCentavos: number | null };

export async function quoteDrift(db: Db, user: SessionUser, quoteId: number, now = new Date()): Promise<Drift[]> {
  assertCan(user, "cost:view");
  const out: Drift[] = [];
  for (const it of await getItems(db, quoteId)) {
    if (it.tipo !== "produto" || it.produtoId === null) continue;
    let atual: number | null;
    try {
      atual = (await snapshotProduct(db, it.produtoId, now)).values.custoCentavos;
    } catch (e) {
      if (!(e instanceof NoValidCostError)) throw e;
      atual = null;
    }
    if (atual !== it.custoCentavos) {
      out.push({ itemId: it.id, descricao: it.descricao, custoCongeladoCentavos: it.custoCentavos, custoAtualCentavos: atual });
    }
  }
  return out;
}

export type { QuoteStatus };
