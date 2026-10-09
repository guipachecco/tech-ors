import { and, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { currentCost, type CostOffer } from "@/domain/costs";
import type { Bps, Cents } from "@/domain/money";
import { salePriceCents } from "@/domain/pricing";
import { normalizeSearch, searchTokens } from "@/domain/search";
import { recordAudit, recordAuditMany } from "@/infra/audit";
import { can } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import type { Db } from "@/infra/db/client";
import { fornecedores, ofertasCusto, produtos } from "@/infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "@/infra/validation";
import { loadPricingContext, resolveRuleWith, type PricingContext } from "../margins/service";

export type ProductRow = typeof produtos.$inferSelect;
export type CostStatus = "valido" | "vencido" | "sem_preco";

export type ProductView = {
  id: number;
  sku: string;
  fabricante: string;
  modelo: string;
  categoria: string;
  descricao: string;
  fotoVersao: number | null;
  precoVendaCentavos: Cents | null;
  statusCusto: CostStatus;
  custoObtidoEm: Date | null;
  custoValidoAte: Date | null;
  /** Presentes somente para quem tem a permissão cost:view. */
  custo?: { custoCentavos: Cents; fornecedorId: number; fornecedorNome: string; urlProduto: string | null };
  margemBps?: Bps;
  margemMinimaBps?: Bps;
};

export const productSchema = z.object({
  sku: z.string().trim().min(1, "Informe o SKU").max(60),
  fabricante: z.string().trim().min(1, "Informe o fabricante").max(80),
  modelo: z.string().trim().min(1, "Informe o modelo").max(120),
  categoria: z.string().trim().min(1, "Informe a categoria").max(80),
  descricao: z.string().trim().max(2000).default(""),
  especificacoes: z.string().trim().max(4000).optional(),
});
export type ProductInput = z.input<typeof productSchema>;

const buildSearch = (p: { sku: string; fabricante: string; modelo: string; categoria: string; descricao: string }) =>
  normalizeSearch([p.sku, p.fabricante, p.modelo, p.categoria, p.descricao].join(" "));

export async function saveProduct(db: Db, user: SessionUser, input: ProductInput & { id?: number }, now = new Date()): Promise<ProductRow> {
  const data = parseInput(productSchema, input);
  const values = { ...data, especificacoes: data.especificacoes || null, busca: buildSearch(data), atualizadoEm: now };
  const dup = await db.select().from(produtos).where(eq(produtos.sku, data.sku)).get();
  if (dup && dup.id !== input.id) throw new ValidationError({ sku: "Já existe um produto com esse SKU" });

  if (input.id) {
    const before = await db.select().from(produtos).where(eq(produtos.id, input.id)).get();
    if (!before) throw new NotFoundError("Produto");
    const after = await db.update(produtos).set(values).where(eq(produtos.id, input.id)).returning().get();
    await recordAudit(db, { userId: user.id, acao: "produto.alterar", entidade: "produto", entidadeId: after.id, antes: before, depois: after });
    return after;
  }
  const created = await db.insert(produtos).values(values).returning().get();
  await recordAudit(db, { userId: user.id, acao: "produto.criar", entidade: "produto", entidadeId: created.id, depois: created });
  return created;
}

const INSERT_CHUNK = 100;
const LOOKUP_CHUNK = 400;

/**
 * Cria vários produtos de uma vez (importação de planilha): valida tudo na memória, confere SKUs repetidos
 * (entre si e no banco) com poucas consultas e grava em lotes. Tudo ou nada fica por conta da transação de quem chama.
 */
export async function createProducts(db: Db, user: SessionUser, inputs: ProductInput[], now = new Date()): Promise<ProductRow[]> {
  if (inputs.length === 0) return [];
  const rows = inputs.map((input) => {
    const data = parseInput(productSchema, input);
    return { ...data, especificacoes: data.especificacoes || null, busca: buildSearch(data), atualizadoEm: now };
  });

  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.sku)) throw new ValidationError({ sku: "Já existe um produto com esse SKU" });
    seen.add(r.sku);
  }
  const skus = [...seen];
  for (let i = 0; i < skus.length; i += LOOKUP_CHUNK) {
    const dup = await db.select({ sku: produtos.sku }).from(produtos).where(inArray(produtos.sku, skus.slice(i, i + LOOKUP_CHUNK))).limit(1).get();
    if (dup) throw new ValidationError({ sku: "Já existe um produto com esse SKU" });
  }

  const created: ProductRow[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    created.push(...(await db.insert(produtos).values(rows.slice(i, i + INSERT_CHUNK)).returning().all()));
  }
  await recordAuditMany(db, created.map((p) => ({ userId: user.id, acao: "produto.criar", entidade: "produto", entidadeId: p.id, depois: p })));
  return created;
}

type OfferRow = {
  id: number;
  supplierId: number;
  costCents: number;
  obtainedAt: Date;
  validUntil: Date;
  fornecedorNome: string;
  urlProduto: string | null;
};

/** Ofertas de custo de vários produtos numa consulta só (em vez de uma por produto). */
async function loadOffers(db: Db, productIds: number[]): Promise<Map<number, OfferRow[]>> {
  const out = new Map<number, OfferRow[]>();
  for (let i = 0; i < productIds.length; i += 400) {
    const rows = await db
      .select({
        produtoId: ofertasCusto.produtoId,
        id: ofertasCusto.id,
        supplierId: ofertasCusto.fornecedorId,
        costCents: ofertasCusto.custoCentavos,
        obtainedAt: ofertasCusto.obtidoEm,
        validUntil: ofertasCusto.validoAte,
        fornecedorNome: fornecedores.nome,
        urlProduto: ofertasCusto.urlProduto,
      })
      .from(ofertasCusto)
      .innerJoin(fornecedores, eq(fornecedores.id, ofertasCusto.fornecedorId))
      .where(inArray(ofertasCusto.produtoId, productIds.slice(i, i + 400)))
      .all();
    for (const { produtoId, ...offer } of rows) {
      if (!out.has(produtoId)) out.set(produtoId, []);
      out.get(produtoId)!.push(offer);
    }
  }
  return out;
}

/** Monta a visão do produto a partir de dados já carregados (sem consultar o banco). */
function buildView(user: SessionUser, p: ProductRow, offers: OfferRow[], ctx: PricingContext, now: Date): ProductView {
  const asDomain: CostOffer[] = offers.map(({ id, supplierId, costCents, obtainedAt, validUntil }) => ({
    id, supplierId, costCents, obtainedAt, validUntil,
  }));
  const best = currentCost(asDomain, now);
  const rule = resolveRuleWith(ctx, p);
  const tax = ctx.settings.impostosBps;

  const base: ProductView = {
    id: p.id,
    sku: p.sku,
    fabricante: p.fabricante,
    modelo: p.modelo,
    categoria: p.categoria,
    descricao: p.descricao,
    fotoVersao: p.fotoVersao,
    precoVendaCentavos: best ? salePriceCents(best.costCents, rule.margemBps, tax) : null,
    statusCusto: best ? "valido" : offers.length > 0 ? "vencido" : "sem_preco",
    custoObtidoEm: null,
    custoValidoAte: null,
  };
  const reference = best ?? [...asDomain].sort((a, b) => b.obtainedAt.getTime() - a.obtainedAt.getTime())[0] ?? null;
  if (reference) {
    base.custoObtidoEm = reference.obtainedAt;
    base.custoValidoAte = reference.validUntil;
  }
  if (can(user, "cost:view")) {
    if (best) {
      const row = offers.find((o) => o.id === best.id)!;
      base.custo = {
        custoCentavos: best.costCents,
        fornecedorId: best.supplierId,
        fornecedorNome: row.fornecedorNome,
        urlProduto: row.urlProduto,
      };
    }
    base.margemBps = rule.margemBps;
    base.margemMinimaBps = rule.margemMinimaBps;
  }
  return base;
}

export async function toView(db: Db, user: SessionUser, p: ProductRow, now = new Date()): Promise<ProductView> {
  const [offers, ctx] = await Promise.all([loadOffers(db, [p.id]), loadPricingContext(db)]);
  return buildView(user, p, offers.get(p.id) ?? [], ctx, now);
}

export async function searchProducts(db: Db, user: SessionUser, query: string, limit = 50, now = new Date()): Promise<ProductView[]> {
  const tokens = searchTokens(query);
  const conditions = [eq(produtos.ativo, true), ...tokens.map((t) => like(produtos.busca, `%${t}%`))];
  const rows = await db.select().from(produtos).where(and(...conditions)).orderBy(produtos.fabricante, produtos.modelo).limit(limit).all();
  const [offers, ctx] = await Promise.all([loadOffers(db, rows.map((p) => p.id)), loadPricingContext(db)]);
  return rows.map((p) => buildView(user, p, offers.get(p.id) ?? [], ctx, now));
}

export async function getProductView(db: Db, user: SessionUser, id: number, now = new Date()): Promise<ProductView> {
  const p = await db.select().from(produtos).where(eq(produtos.id, id)).get();
  if (!p) throw new NotFoundError("Produto");
  return await toView(db, user, p, now);
}

export async function getProductRow(db: Db, id: number): Promise<ProductRow> {
  const p = await db.select().from(produtos).where(eq(produtos.id, id)).get();
  if (!p) throw new NotFoundError("Produto");
  return p;
}
