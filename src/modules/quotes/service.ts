import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { currentCost, type CostOffer } from "@/domain/costs";
import { salePriceCents } from "@/domain/pricing";
import { canTransition, type QuoteStatus } from "@/domain/quoteStatus";
import { formatQuoteNumber } from "@/domain/quoteNumber";
import { recordAudit } from "@/infra/audit";
import { assertCan, can, ForbiddenError } from "../auth/permissions";
import type { SessionUser } from "../auth/sessions";
import { resolveRule } from "../catalog/margins/service";
import { getSettings } from "../catalog/settings/service";
import type { Db } from "@/infra/db/client";
import { clientes, ofertasCusto, orcamentoItens, orcamentos, produtos, sequenciaOrcamento, usuarios } from "@/infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "@/infra/validation";
import { InvalidTransitionError, NoValidCostError, QuoteLockedError, SendBlockedError, type SendBlockReason } from "./errors";
import { checkSendable, OVERRIDABLE, quoteTotals, type Quote, type QuoteItem } from "./guard";

const DAY = 86_400_000;

// ---------- leitura ----------

/** Código do link do cliente: 24 bytes aleatórios (impossível de adivinhar). */
export const newPublicToken = () => randomBytes(24).toString("base64url");

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
      aprovacaoStatus: orcamentos.aprovacaoStatus,
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

/**
 * Confere se o orçamento pode ser alterado. Em aprovação: ninguém edita (o revisor pode só atualizar preços).
 * Já aprovado: qualquer alteração invalida a aprovação (o que foi aprovado deixou de ser o que está na tela).
 */
async function ensureEditable(db: Db, q: Quote, user: SessionUser, opts: { approverRefresh?: boolean } = {}): Promise<void> {
  if (q.status !== "em_elaboracao") throw new QuoteLockedError();
  if (q.aprovacaoStatus === "pendente") {
    if (opts.approverRefresh && can(user, "quote:approve")) return;
    throw new QuoteLockedError("Este orçamento está aguardando aprovação. Peça para devolvê-lo antes de editar.");
  }
  if (q.aprovacaoStatus === "aprovada") {
    await db.update(orcamentos).set({ aprovacaoStatus: "nenhuma", aprovadoPor: null, aprovadoEm: null }).where(eq(orcamentos.id, q.id)).run();
    await recordAudit(db, { userId: user.id, acao: "orcamento.aprovacao_invalidada", entidade: "orcamento", entidadeId: q.id, depois: { motivo: "orçamento alterado após a aprovação" } });
  }
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
  await ensureEditable(db, q, user);
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
  await ensureEditable(db, q, user);
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
  await ensureEditable(db, await getQuote(db, quoteId), user);
  const data = parseInput(serviceSchema, input);
  const item = await db.insert(orcamentoItens).values({ orcamentoId: quoteId, tipo: "servico", ...data }).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_adicionar", entidade: "orcamento", entidadeId: quoteId, depois: { itemId: item.id, servico: data.descricao } });
  return item;
}

export async function setFrete(db: Db, user: SessionUser, quoteId: number, cents: number): Promise<Quote> {
  await ensureEditable(db, await getQuote(db, quoteId), user);
  const frete = parseInput(z.number().int().min(0).max(100_000_000_00), cents);
  const after = await db.update(orcamentos).set({ freteCentavos: frete }).where(eq(orcamentos.id, quoteId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.frete", entidade: "orcamento", entidadeId: quoteId, depois: { frete } });
  return after;
}

async function itemAndQuote(db: Db, user: SessionUser, itemId: number) {
  const item = await db.select().from(orcamentoItens).where(eq(orcamentoItens.id, itemId)).get();
  if (!item) throw new NotFoundError("Item");
  const quote = await getQuote(db, item.orcamentoId);
  await ensureEditable(db, quote, user);
  return { item, quote };
}

export async function updateItem(db: Db, user: SessionUser, itemId: number, input: { quantidade?: number; descontoBps?: number }): Promise<QuoteItem> {
  const { item } = await itemAndQuote(db, user, itemId);
  const patch: { quantidade?: number; descontoBps?: number } = {};
  if (input.quantidade !== undefined) patch.quantidade = parseInput(qtySchema, input.quantidade);
  if (input.descontoBps !== undefined) patch.descontoBps = parseInput(discountSchema, input.descontoBps);
  if (Object.keys(patch).length === 0) throw new ValidationError({ _: "Nada para alterar" });
  const after = await db.update(orcamentoItens).set(patch).where(eq(orcamentoItens.id, itemId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_alterar", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, quantidade: item.quantidade, descontoBps: item.descontoBps }, depois: { itemId, ...patch } });
  return after;
}

export async function removeItem(db: Db, user: SessionUser, itemId: number): Promise<void> {
  const { item } = await itemAndQuote(db, user, itemId);
  await db.delete(orcamentoItens).where(eq(orcamentoItens.id, itemId)).run();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_remover", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, descricao: item.descricao } });
}

/** Traz custo, margem e preço vigentes do catálogo para o item. */
export async function repriceItem(db: Db, user: SessionUser, itemId: number, now = new Date()): Promise<QuoteItem> {
  const { item } = await itemAndQuote(db, user, itemId);
  if (item.tipo !== "produto" || item.produtoId === null) throw new ValidationError({ _: "Só produtos podem ser reprecificados" });
  const { values } = await snapshotProduct(db, item.produtoId, now);
  const after = await db.update(orcamentoItens).set(values).where(eq(orcamentoItens.id, itemId)).returning().get();
  await recordAudit(db, { userId: user.id, acao: "orcamento.item_reprecificar", entidade: "orcamento", entidadeId: item.orcamentoId, antes: { itemId, preco: item.precoUnitarioCentavos }, depois: { itemId, preco: after.precoUnitarioCentavos } });
  return after;
}

export type PriceChange = {
  itemId: number;
  descricao: string;
  precoAntesCentavos: number;
  /** null quando o produto está sem custo válido (o item não foi alterado). */
  precoDepoisCentavos: number | null;
};

/** Reprecifica todos os produtos do orçamento com o custo vigente do catálogo; devolve só o que mudou de preço. */
async function repriceAllItems(db: Db, userId: number, quoteId: number, now: Date): Promise<PriceChange[]> {
  const changes: PriceChange[] = [];
  for (const it of await getItems(db, quoteId)) {
    if (it.tipo !== "produto" || it.produtoId === null) continue;
    let values;
    try {
      values = (await snapshotProduct(db, it.produtoId, now)).values;
    } catch (e) {
      if (!(e instanceof NoValidCostError)) throw e;
      changes.push({ itemId: it.id, descricao: it.descricao, precoAntesCentavos: it.precoUnitarioCentavos, precoDepoisCentavos: null });
      continue;
    }
    const unchanged =
      values.custoCentavos === it.custoCentavos && values.margemBps === it.margemBps && values.impostosBps === it.impostosBps &&
      values.precoUnitarioCentavos === it.precoUnitarioCentavos && values.custoValidoAte.getTime() === it.custoValidoAte?.getTime() &&
      values.ofertaCustoId === it.ofertaCustoId;
    if (unchanged) continue;
    await db.update(orcamentoItens).set(values).where(eq(orcamentoItens.id, it.id)).run();
    if (values.precoUnitarioCentavos !== it.precoUnitarioCentavos) {
      changes.push({ itemId: it.id, descricao: it.descricao, precoAntesCentavos: it.precoUnitarioCentavos, precoDepoisCentavos: values.precoUnitarioCentavos });
    }
  }
  await recordAudit(db, { userId, acao: "orcamento.reprecificar_tudo", entidade: "orcamento", entidadeId: quoteId, depois: { alterados: changes.length } });
  return changes;
}

/** Botão "Atualizar todos os preços": traz o custo vigente do catálogo para todos os itens de produto de uma vez. */
export async function repriceQuote(db: Db, user: SessionUser, quoteId: number, now = new Date()): Promise<PriceChange[]> {
  const q = await getQuote(db, quoteId);
  await ensureEditable(db, q, user, { approverRefresh: true });
  return await repriceAllItems(db, user.id, quoteId, now);
}

// ---------- aprovação interna ----------

const noteSchema = z.string().trim().min(3, "Escreva o que precisa ser ajustado").max(500);

/**
 * O vendedor pede a aprovação: os preços são atualizados com o catálogo de agora e o orçamento fica travado
 * até um administrador aprovar ou devolver. O que mudou de preço fica guardado para o revisor ver.
 */
export async function requestApproval(db: Db, user: SessionUser, quoteId: number, now = new Date()): Promise<{ quote: Quote; mudancas: PriceChange[] }> {
  const q = await getQuote(db, quoteId);
  if (q.status !== "em_elaboracao") throw new InvalidTransitionError(q.status, "em aprovação");
  if (q.aprovacaoStatus === "pendente") throw new ValidationError({ _: "Este orçamento já está aguardando aprovação." });
  if (q.aprovacaoStatus === "aprovada") throw new ValidationError({ _: "Este orçamento já está aprovado." });

  const mudancas = await repriceAllItems(db, user.id, quoteId, now);
  // Só o que nenhum revisor pode liberar impede o pedido; custo vencido e margem baixa chegam ao revisor, que decide.
  const motivos: SendBlockReason[] = [];
  if ((await getItems(db, quoteId)).length === 0) motivos.push("sem_itens");
  if (q.validoAte.getTime() <= now.getTime()) motivos.push("validade_vencida");
  if (motivos.length > 0) throw new SendBlockedError(motivos);

  const after = await db
    .update(orcamentos)
    .set({
      aprovacaoStatus: "pendente", aprovacaoPedidaPor: user.id, aprovacaoPedidaEm: now, aprovadoPor: null, aprovadoEm: null,
      aprovacaoNota: null, aprovacaoMudancasJson: JSON.stringify(mudancas),
    })
    .where(and(eq(orcamentos.id, quoteId), eq(orcamentos.aprovacaoStatus, "nenhuma")))
    .returning()
    .get();
  if (!after) throw new ValidationError({ _: "O orçamento mudou de situação. Atualize a página." });
  await recordAudit(db, { userId: user.id, acao: "orcamento.aprovacao_pedir", entidade: "orcamento", entidadeId: quoteId, depois: { numero: q.numero, precosAlterados: mudancas.length } });
  return { quote: after, mudancas };
}

export function approvalChanges(q: Pick<Quote, "aprovacaoMudancasJson">): PriceChange[] {
  return q.aprovacaoMudancasJson ? (JSON.parse(q.aprovacaoMudancasJson) as PriceChange[]) : [];
}

/**
 * O administrador aprova (e, se quiser, já envia). Se os custos do catálogo mudaram depois do pedido, a aprovação
 * é recusada: o que ele viu já não é o que valeria. Ele atualiza os preços e revisa de novo.
 */
export async function approveQuote(
  db: Db, user: SessionUser, quoteId: number, opts: { enviar?: boolean; justificativa?: string } = {}, now = new Date(),
): Promise<Quote> {
  assertCan(user, "quote:approve");
  const q = await getQuote(db, quoteId);
  if (q.status !== "em_elaboracao" || q.aprovacaoStatus !== "pendente") throw new ValidationError({ _: "Este orçamento não está aguardando aprovação." });
  if ((await quoteDrift(db, user, quoteId, now)).length > 0) {
    throw new ValidationError({ _: "Os custos do catálogo mudaram depois do pedido. Clique em “Atualizar preços” e revise de novo." });
  }
  const after = await db
    .update(orcamentos)
    .set({ aprovacaoStatus: "aprovada", aprovadoPor: user.id, aprovadoEm: now, aprovacaoNota: null })
    .where(and(eq(orcamentos.id, quoteId), eq(orcamentos.aprovacaoStatus, "pendente")))
    .returning()
    .get();
  if (!after) throw new ValidationError({ _: "O orçamento mudou de situação. Atualize a página." });
  await recordAudit(db, { userId: user.id, acao: "orcamento.aprovacao_aprovar", entidade: "orcamento", entidadeId: quoteId, depois: { numero: q.numero } });
  return opts.enviar ? await sendQuote(db, user, quoteId, { justificativa: opts.justificativa }, now) : after;
}

/** Devolve para ajustes (revisor, com recado obrigatório) ou retira o pedido (quem pediu). Libera a edição de novo. */
export async function cancelApproval(db: Db, user: SessionUser, quoteId: number, nota?: string): Promise<Quote> {
  const q = await getQuote(db, quoteId);
  if (q.status !== "em_elaboracao" || q.aprovacaoStatus !== "pendente") throw new ValidationError({ _: "Este orçamento não está aguardando aprovação." });
  const reviewer = can(user, "quote:approve");
  if (!reviewer && q.aprovacaoPedidaPor !== user.id) throw new ForbiddenError("quote:approve");
  const recado = reviewer ? parseInput(noteSchema, nota ?? "") : null;
  const after = await db
    .update(orcamentos)
    .set({ aprovacaoStatus: "nenhuma", aprovacaoNota: recado, aprovacaoPedidaPor: null, aprovacaoPedidaEm: null })
    .where(eq(orcamentos.id, quoteId))
    .returning()
    .get();
  await recordAudit(db, { userId: user.id, acao: reviewer ? "orcamento.aprovacao_devolver" : "orcamento.aprovacao_retirar", entidade: "orcamento", entidadeId: quoteId, depois: { nota: recado } });
  return after;
}

/** Nomes de quem pediu e de quem aprovou (para mostrar na tela). */
export async function approvalPeople(db: Db, q: Pick<Quote, "aprovacaoPedidaPor" | "aprovadoPor">): Promise<{ pedidoPor: string | null; aprovadoPor: string | null }> {
  const ids = [q.aprovacaoPedidaPor, q.aprovadoPor].filter((v): v is number => v !== null);
  if (ids.length === 0) return { pedidoPor: null, aprovadoPor: null };
  const rows = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, ids)).all();
  const name = (id: number | null) => rows.find((r) => r.id === id)?.nome ?? null;
  return { pedidoPor: name(q.aprovacaoPedidaPor), aprovadoPor: name(q.aprovadoPor) };
}

export type PendingApproval = { id: number; numero: string; clienteNome: string; pedidoPor: string | null; pedidoEm: Date | null; totalCentavos: number };

export async function listPendingApprovals(db: Db, user: SessionUser): Promise<PendingApproval[]> {
  assertCan(user, "quote:approve");
  const rows = await db
    .select({
      id: orcamentos.id, numero: orcamentos.numero, freteCentavos: orcamentos.freteCentavos, clienteNome: clientes.razaoSocial,
      pedidoPor: usuarios.nome, pedidoEm: orcamentos.aprovacaoPedidaEm,
    })
    .from(orcamentos)
    .innerJoin(clientes, eq(clientes.id, orcamentos.clienteId))
    .leftJoin(usuarios, eq(usuarios.id, orcamentos.aprovacaoPedidaPor))
    .where(and(eq(orcamentos.status, "em_elaboracao"), eq(orcamentos.aprovacaoStatus, "pendente")))
    .orderBy(orcamentos.aprovacaoPedidaEm)
    .all();
  const out: PendingApproval[] = [];
  for (const r of rows) {
    const { freteCentavos, ...rest } = r;
    out.push({ ...rest, totalCentavos: quoteTotals({ freteCentavos }, await getItems(db, r.id)).totalCentavos });
  }
  return out;
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

    if ((await getSettings(tx as unknown as Db)).exigirAprovacaoInterna && !can(user, "quote:approve") && q.aprovacaoStatus !== "aprovada") {
      throw new SendBlockedError(["sem_aprovacao"], "Este orçamento precisa da aprovação de um administrador antes de ser enviado.");
    }

    const after = await tx.update(orcamentos).set({ status: "enviado", enviadoEm: now, tokenPublico: q.tokenPublico ?? newPublicToken() }).where(and(eq(orcamentos.id, quoteId), eq(orcamentos.status, "em_elaboracao"))).returning().get();
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

// ---------- link do cliente ----------

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,64}$/;
const CLIENT_VISIBLE: QuoteStatus[] = ["enviado", "aprovado", "recusado", "expirado"];

/** Orçamento do link público (só depois de enviado). `null` se o código não existe ou o link foi trocado. */
export async function getQuoteByToken(db: Db, token: string): Promise<Quote | null> {
  if (!TOKEN_FORMAT.test(token)) return null;
  const q = await db.select().from(orcamentos).where(eq(orcamentos.tokenPublico, token)).get();
  return q && CLIENT_VISIBLE.includes(q.status) ? q : null;
}

/** Link novo para o cliente; o anterior deixa de funcionar. */
export async function regeneratePublicLink(db: Db, user: SessionUser, quoteId: number): Promise<string> {
  const q = await getQuote(db, quoteId);
  if (!CLIENT_VISIBLE.includes(q.status)) throw new ValidationError({ _: "O link do cliente existe depois que o orçamento é marcado como enviado." });
  const token = newPublicToken();
  await db.update(orcamentos).set({ tokenPublico: token }).where(eq(orcamentos.id, quoteId)).run();
  await recordAudit(db, { userId: user.id, acao: "orcamento.link_renovar", entidade: "orcamento", entidadeId: quoteId });
  return token;
}

const clientAnswerSchema = z.object({
  resultado: z.enum(["aprovado", "recusado"]),
  nome: z.string().trim().min(2, "Informe o seu nome").max(100),
  motivo: z.string().trim().max(500).optional(),
});

/** O cliente aprova ou recusa pelo link. Só vale enquanto o orçamento está enviado e dentro da validade. */
export async function respondAsClient(
  db: Db, token: string, input: z.input<typeof clientAnswerSchema>, meta: { ip?: string } = {}, now = new Date(),
): Promise<Quote> {
  const q = await getQuoteByToken(db, token);
  if (!q) throw new NotFoundError("Orçamento");
  const data = parseInput(clientAnswerSchema, input);
  if (q.status !== "enviado") throw new ValidationError({ _: q.status === "expirado" ? "Esta proposta expirou." : "Este orçamento já foi respondido." });
  if (q.validoAte.getTime() <= now.getTime()) throw new ValidationError({ _: "Esta proposta expirou. Peça uma nova ao vendedor." });
  const motivo = data.motivo?.trim() || null;
  if (data.resultado === "recusado" && !motivo) throw new ValidationError({ motivo: "Conte o motivo da recusa" });

  const after = await db
    .update(orcamentos)
    .set({ status: data.resultado, motivoResultado: motivo, respondidoPorNome: data.nome, respondidoEm: now })
    .where(and(eq(orcamentos.id, q.id), eq(orcamentos.status, "enviado")))
    .returning()
    .get();
  if (!after) throw new ValidationError({ _: "Este orçamento já foi respondido." });
  await recordAudit(db, { userId: null, acao: `orcamento.${data.resultado}_pelo_cliente`, entidade: "orcamento", entidadeId: q.id, depois: { numero: q.numero, nome: data.nome, motivo, ip: meta.ip ?? null } });
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
