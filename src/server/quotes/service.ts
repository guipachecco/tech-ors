import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { currentCost, type CostOffer } from "../../domain/costs";
import { salePriceCents } from "../../domain/pricing";
import { canTransition, type QuoteStatus } from "../../domain/quoteStatus";
import { formatQuoteNumber } from "../../domain/quoteNumber";
import { recordAudit } from "../audit";
import { assertCan, can } from "../auth/permissions";
import type { SessionUser } from "../auth/sessions";
import { resolveRule } from "../catalog/margins";
import { getSettings } from "../catalog/settings";
import type { Db } from "../db/client";
import { clientes, ofertasCusto, orcamentoItens, orcamentos, produtos, sequenciaOrcamento } from "../db/schema";
import { NotFoundError, parseInput, ValidationError } from "../validation";
import { InvalidTransitionError, NoValidCostError, QuoteLockedError, SendBlockedError } from "./errors";
import { checkSendable, OVERRIDABLE, type Quote, type QuoteItem } from "./guard";

const DAY = 86_400_000;

// ---------- leitura ----------

export function getQuote(db: Db, id: number): Quote {
  const q = db.select().from(orcamentos).where(eq(orcamentos.id, id)).get();
  if (!q) throw new NotFoundError("Orçamento");
  return q;
}

export function getItems(db: Db, quoteId: number): QuoteItem[] {
  return db.select().from(orcamentoItens).where(eq(orcamentoItens.orcamentoId, quoteId)).orderBy(orcamentoItens.id).all();
}

export function listQuotes(db: Db, limit = 200) {
  return db
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
}

function assertEditable(q: Quote) {
  if (q.status !== "em_elaboracao") throw new QuoteLockedError();
}

// ---------- criação ----------

function insertQuote(db: Db, user: SessionUser, clientId: number, now: Date, source?: Quote) {
  const settings = getSettings(db);
  return db.transaction((tx) => {
    const client = tx.select().from(clientes).where(eq(clientes.id, clientId)).get();
    if (!client) throw new NotFoundError("Cliente");
    const year = now.getFullYear();
    const seqRow = tx.select().from(sequenciaOrcamento).where(eq(sequenciaOrcamento.ano, year)).get();
    const seq = (seqRow?.ultimo ?? 0) + 1;
    if (seqRow) tx.update(sequenciaOrcamento).set({ ultimo: seq }).where(eq(sequenciaOrcamento.ano, year)).run();
    else tx.insert(sequenciaOrcamento).values({ ano: year, ultimo: seq }).run();

    return tx
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

export function createQuote(db: Db, user: SessionUser, clientId: number, now = new Date()): Quote {
  const q = insertQuote(db, user, clientId, now);
  recordAudit(db, { userId: user.id, acao: "orcamento.criar", entidade: "orcamento", entidadeId: q.id, depois: { numero: q.numero, clienteId: clientId } });
  return q;
}

export function duplicateQuote(db: Db, user: SessionUser, quoteId: number, now = new Date()): Quote {
  const source = getQuote(db, quoteId);
  const copy = insertQuote(db, user, source.clienteId, now, source);
  for (const it of getItems(db, quoteId)) {
    const { id: _id, orcamentoId: _o, ...rest } = it;
    db.insert(orcamentoItens).values({ ...rest, orcamentoId: copy.id }).run();
  }
  recordAudit(db, { userId: user.id, acao: "orcamento.duplicar", entidade: "orcamento", entidadeId: copy.id, depois: { numero: copy.numero, origem: source.numero } });
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

export function updateQuoteDetails(db: Db, user: SessionUser, quoteId: number, input: z.input<typeof detailsSchema>): Quote {
  const q = getQuote(db, quoteId);
  assertEditable(q);
  const data = parseInput(detailsSchema, input);
  const after = db.update(orcamentos).set(data).where(eq(orcamentos.id, quoteId)).returning().get();
  recordAudit(db, { userId: user.id, acao: "orcamento.alterar", entidade: "orcamento", entidadeId: quoteId, antes: q, depois: after });
  return after;
}

const qtySchema = z.number().int("Quantidade inteira").min(1, "Mínimo 1").max(100_000);
const discountSchema = z.number().int().min(0).max(10_000, "Desconto acima de 100%");

function snapshotProduct(db: Db, productId: number, now: Date) {
  const product = db.select().from(produtos).where(eq(produtos.id, productId)).get();
  if (!product) throw new NotFoundError("Produto");
  const offers = db.select().from(ofertasCusto).where(eq(ofertasCusto.produtoId, productId)).all();
  const domainOffers: CostOffer[] = offers.map((o) => ({
    id: o.id, supplierId: o.fornecedorId, costCents: o.custoCentavos, obtainedAt: o.obtidoEm, validUntil: o.validoAte,
  }));
  const best = currentCost(domainOffers, now);
  if (!best) throw new NoValidCostError();
  const rule = resolveRule(db, product);
  const tax = getSettings(db).impostosBps;
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

export function addProductItem(db: Db, user: SessionUser, quoteId: number, productId: number, qty: number, now = new Date()): QuoteItem {
  const q = getQuote(db, quoteId);
  assertEditable(q);
  const quantidade = parseInput(qtySchema, qty);
  const { product, values } = snapshotProduct(db, productId, now);
  const descricao = `${product.fabricante} ${product.modelo}`; // título; as especificações vão em `detalhes`
  const item = db
    .insert(orcamentoItens)
    .values({ orcamentoId: quoteId, tipo: "produto", produtoId: productId, descricao, detalhes: product.descricao, quantidade, ...values })
    .returning()
    .get();
  recordAudit(db, { userId: user.id, acao: "orcamento.item_adicionar", entidade: "orcamento", entidadeId: quoteId, depois: { itemId: item.id, produtoId: productId, quantidade } });
  return item;
}

const serviceSchema = z.object({
  descricao: z.string().trim().min(1, "Descreva o serviço").max(300),
  quantidade: qtySchema,
  precoUnitarioCentavos: z.number().int().min(0).max(100_000_000_00),
});

export function addServiceItem(db: Db, user: SessionUser, quoteId: number, input: z.input<typeof serviceSchema>): QuoteItem {
  assertEditable(getQuote(db, quoteId));
  const data = parseInput(serviceSchema, input);
  const item = db.insert(orcamentoItens).values({ orcamentoId: quoteId, tipo: "servico", ...data }).returning().get();
  recordAudit(db, { userId: user.id, acao: "orcamento.item_adicionar", entidade: "orcamento", entidadeId: quoteId, depois: { itemId: item.id, servico: data.descricao } });
  return item;
}

export function setFrete(db: Db, user: SessionUser, quoteId: number, cents: number): Quote {
  assertEditable(getQuote(db, quoteId));
  const frete = parseInput(z.number().int().min(0).max(100_000_000_00), cents);
  const after = db.update(orcamentos).set({ freteCentavos: frete }).where(eq(orcamentos.id, quoteId)).returning().get();
  recordAudit(db, { userId: user.id, acao: "orcamento.frete", entidade: "orcamento", entidadeId: quoteId, depois: { frete } });
  return after;
}

function itemAndQuote(db: Db, itemId: number) {
  const item = db.select().from(orcamentoItens).where(eq(orcamentoItens.id, itemId)).get();
  if (!item) throw new NotFoundError("Item");
  const quote = getQuote(db, item.orcamentoId);
  assertEditable(quote);
  return { item, quote };
}

export function updateItem(db: Db, user: SessionUser, itemId: number, input: { quantidade?: number; descontoBps?: number }): QuoteItem {
  const { item } = itemAndQuote(db, itemId);
  const patch: { quantidade?: number; descontoBps?: number } = {};
  if (input.quantidade !== undefined) patch.quantidade = parseInput(qtySchema, input.quantidade);
  if (input.descontoBps !== undefined) patch.descontoBps = parseInput(discountSchema, input.descontoBps);
  if (Object.keys(patch).length === 0) throw new ValidationError({ _: "Nada para alterar" });
  const after = db.update(orcamentoItens).set(patch).where(eq(orcamentoItens.id, itemId)).returning().get();
  recordAudit(db, { userId: user.id, acao: "orcamento.item_alterar", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, quantidade: item.quantidade, descontoBps: item.descontoBps }, depois: { itemId, ...patch } });
  return after;
}

export function removeItem(db: Db, user: SessionUser, itemId: number): void {
  const { item } = itemAndQuote(db, itemId);
  db.delete(orcamentoItens).where(eq(orcamentoItens.id, itemId)).run();
  recordAudit(db, { userId: user.id, acao: "orcamento.item_remover", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, descricao: item.descricao } });
}

/** Traz custo, margem e preço vigentes do catálogo para o item. */
export function repriceItem(db: Db, user: SessionUser, itemId: number, now = new Date()): QuoteItem {
  const { item } = itemAndQuote(db, itemId);
  if (item.tipo !== "produto" || item.produtoId === null) throw new ValidationError({ _: "Só produtos podem ser reprecificados" });
  const { values } = snapshotProduct(db, item.produtoId, now);
  const after = db.update(orcamentoItens).set(values).where(eq(orcamentoItens.id, itemId)).returning().get();
  recordAudit(db, { userId: user.id, acao: "orcamento.item_reprecificar", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, preco: item.precoUnitarioCentavos }, depois: { itemId, preco: after.precoUnitarioCentavos } });
  return after;
}

// ---------- status ----------

export function sendQuote(db: Db, user: SessionUser, quoteId: number, opts: { justificativa?: string } = {}, now = new Date()): Quote {
  return db.transaction((tx) => {
    const q = tx.select().from(orcamentos).where(eq(orcamentos.id, quoteId)).get();
    if (!q) throw new NotFoundError("Orçamento");
    if (!canTransition(q.status, "enviado")) throw new InvalidTransitionError(q.status, "enviado");
    const items = tx.select().from(orcamentoItens).where(eq(orcamentoItens.orcamentoId, quoteId)).all();

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

    const after = tx.update(orcamentos).set({ status: "enviado", enviadoEm: now }).where(and(eq(orcamentos.id, quoteId), eq(orcamentos.status, "em_elaboracao"))).returning().get();
    if (!after) throw new InvalidTransitionError(q.status, "enviado");
    recordAudit(tx as unknown as Db, {
      userId: user.id,
      acao: "orcamento.enviar",
      entidade: "orcamento",
      entidadeId: quoteId,
      depois: { numero: q.numero, liberadoPor: overridden.length ? { motivos: overridden, justificativa: opts.justificativa?.trim() } : null },
    });
    return after;
  });
}

export function setOutcome(db: Db, user: SessionUser, quoteId: number, outcome: "aprovado" | "recusado", motivo?: string): Quote {
  const q = getQuote(db, quoteId);
  if (!canTransition(q.status, outcome)) throw new InvalidTransitionError(q.status, outcome);
  const reason = motivo?.trim() || null;
  if (outcome === "recusado" && !reason) throw new ValidationError({ motivo: "Informe o motivo da recusa" });
  const after = db.update(orcamentos).set({ status: outcome, motivoResultado: reason }).where(eq(orcamentos.id, quoteId)).returning().get();
  recordAudit(db, { userId: user.id, acao: `orcamento.${outcome}`, entidade: "orcamento", entidadeId: quoteId, depois: { motivo: reason } });
  return after;
}

export function expireOverdueQuotes(db: Db, now = new Date()): number {
  const overdue = db.select().from(orcamentos).where(and(eq(orcamentos.status, "enviado"), lte(orcamentos.validoAte, now))).all();
  for (const q of overdue) {
    db.update(orcamentos).set({ status: "expirado" }).where(eq(orcamentos.id, q.id)).run();
    recordAudit(db, { userId: null, acao: "orcamento.expirar", entidade: "orcamento", entidadeId: q.id, depois: { numero: q.numero } });
  }
  return overdue.length;
}

// ---------- comparação com o catálogo ----------

export type Drift = { itemId: number; descricao: string; custoCongeladoCentavos: number; custoAtualCentavos: number | null };

export function quoteDrift(db: Db, user: SessionUser, quoteId: number, now = new Date()): Drift[] {
  assertCan(user, "cost:view");
  const out: Drift[] = [];
  for (const it of getItems(db, quoteId)) {
    if (it.tipo !== "produto" || it.produtoId === null) continue;
    let atual: number | null;
    try {
      atual = snapshotProduct(db, it.produtoId, now).values.custoCentavos;
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
