import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { currentCost, type CostOffer } from "../../domain/costs";
import type { Bps, Cents } from "../../domain/money";
import { salePriceCents } from "../../domain/pricing";
import { normalizeSearch, searchTokens } from "../../domain/search";
import { recordAudit } from "../audit";
import { can } from "../auth/permissions";
import type { SessionUser } from "../auth/sessions";
import type { Db } from "../db/client";
import { fornecedores, ofertasCusto, produtos } from "../db/schema";
import { NotFoundError, parseInput, ValidationError } from "../validation";
import { resolveRule } from "./margins";
import { getSettings } from "./settings";

export type ProductRow = typeof produtos.$inferSelect;
export type CostStatus = "valido" | "vencido" | "sem_preco";

export type ProductView = {
  id: number;
  sku: string;
  fabricante: string;
  modelo: string;
  categoria: string;
  descricao: string;
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

export function saveProduct(db: Db, user: SessionUser, input: ProductInput & { id?: number }, now = new Date()): ProductRow {
  const data = parseInput(productSchema, input);
  const values = { ...data, especificacoes: data.especificacoes || null, busca: buildSearch(data), atualizadoEm: now };
  const dup = db.select().from(produtos).where(eq(produtos.sku, data.sku)).get();
  if (dup && dup.id !== input.id) throw new ValidationError({ sku: "Já existe um produto com esse SKU" });

  if (input.id) {
    const before = db.select().from(produtos).where(eq(produtos.id, input.id)).get();
    if (!before) throw new NotFoundError("Produto");
    const after = db.update(produtos).set(values).where(eq(produtos.id, input.id)).returning().get();
    recordAudit(db, { userId: user.id, acao: "produto.alterar", entidade: "produto", entidadeId: after.id, antes: before, depois: after });
    return after;
  }
  const created = db.insert(produtos).values(values).returning().get();
  recordAudit(db, { userId: user.id, acao: "produto.criar", entidade: "produto", entidadeId: created.id, depois: created });
  return created;
}

export function toView(db: Db, user: SessionUser, p: ProductRow, now = new Date()): ProductView {
  const offers = db
    .select({
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
    .where(eq(ofertasCusto.produtoId, p.id))
    .all();
  const asDomain: CostOffer[] = offers.map(({ id, supplierId, costCents, obtainedAt, validUntil }) => ({
    id, supplierId, costCents, obtainedAt, validUntil,
  }));
  const best = currentCost(asDomain, now);
  const rule = resolveRule(db, p);
  const tax = getSettings(db).impostosBps;

  const base: ProductView = {
    id: p.id,
    sku: p.sku,
    fabricante: p.fabricante,
    modelo: p.modelo,
    categoria: p.categoria,
    descricao: p.descricao,
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

export function searchProducts(db: Db, user: SessionUser, query: string, limit = 50, now = new Date()): ProductView[] {
  const tokens = searchTokens(query);
  const conditions = [eq(produtos.ativo, true), ...tokens.map((t) => like(produtos.busca, `%${t}%`))];
  const rows = db.select().from(produtos).where(and(...conditions)).orderBy(produtos.fabricante, produtos.modelo).limit(limit).all();
  return rows.map((p) => toView(db, user, p, now));
}

export function getProductView(db: Db, user: SessionUser, id: number, now = new Date()): ProductView {
  const p = db.select().from(produtos).where(eq(produtos.id, id)).get();
  if (!p) throw new NotFoundError("Produto");
  return toView(db, user, p, now);
}

export function getProductRow(db: Db, id: number): ProductRow {
  const p = db.select().from(produtos).where(eq(produtos.id, id)).get();
  if (!p) throw new NotFoundError("Produto");
  return p;
}
