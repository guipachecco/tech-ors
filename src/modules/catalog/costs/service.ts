import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defaultValidUntil } from "@/domain/costs";
import { recordAuditMany } from "@/infra/audit";
import { assertCan } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import type { Db } from "@/infra/db/client";
import { fornecedores, ofertasCusto, produtos } from "@/infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "@/infra/validation";
import { loadPricingContext, resolveRuleWith } from "../margins/service";
import { httpUrl } from "../suppliers/service";

export type CostOfferRow = typeof ofertasCusto.$inferSelect;

export const offerSchema = z.object({
  produtoId: z.number().int().positive(),
  fornecedorId: z.number().int().positive(),
  skuFornecedor: z.string().trim().max(80).optional(),
  urlProduto: z.union([httpUrl, z.literal("")]).optional(),
  custoCentavos: z.number().int().positive("Informe um custo maior que zero").max(100_000_000_00),
  observacao: z.string().trim().max(500).optional(),
  obtidoEm: z.date().optional(),
  validoAte: z.date().optional(),
});

type OfferInput = z.input<typeof offerSchema>;
const LOOKUP_CHUNK = 400;
const INSERT_CHUNK = 100;

/** Cada atualização cria uma nova linha: o histórico de custos é preservado. */
export async function addCostOffer(db: Db, user: SessionUser, input: OfferInput, now = new Date()): Promise<CostOfferRow> {
  return (await addCostOffers(db, user, [input], now))[0]!;
}

/**
 * Várias ofertas de uma vez (importação): produtos, fornecedores e regras de margem são lidos uma vez só e a
 * gravação é em lotes — numa base na nuvem cada ida ao banco custa uma viagem de rede.
 */
export async function addCostOffers(db: Db, user: SessionUser, inputs: OfferInput[], now = new Date()): Promise<CostOfferRow[]> {
  assertCan(user, "cost:write");
  if (inputs.length === 0) return [];
  const parsed = inputs.map((input) => parseInput(offerSchema, input));

  const productIds = [...new Set(parsed.map((d) => d.produtoId))];
  const products = new Map<number, typeof produtos.$inferSelect>();
  for (let i = 0; i < productIds.length; i += LOOKUP_CHUNK) {
    for (const p of await db.select().from(produtos).where(inArray(produtos.id, productIds.slice(i, i + LOOKUP_CHUNK))).all()) products.set(p.id, p);
  }
  if (productIds.some((id) => !products.has(id))) throw new NotFoundError("Produto");

  const supplierIds = [...new Set(parsed.map((d) => d.fornecedorId))];
  const suppliers = await db.select({ id: fornecedores.id }).from(fornecedores).where(inArray(fornecedores.id, supplierIds)).all();
  if (suppliers.length !== supplierIds.length) throw new NotFoundError("Fornecedor");

  const ctx = await loadPricingContext(db);
  const values = parsed.map((data) => {
    const obtidoEm = data.obtidoEm ?? now;
    const validoAte = data.validoAte ?? defaultValidUntil(obtidoEm, resolveRuleWith(ctx, products.get(data.produtoId)!).validadeCustoDias);
    if (validoAte.getTime() <= obtidoEm.getTime()) {
      throw new ValidationError({ validoAte: "A validade deve ser depois da data do preço" });
    }
    return {
      produtoId: data.produtoId,
      fornecedorId: data.fornecedorId,
      skuFornecedor: data.skuFornecedor || null,
      urlProduto: data.urlProduto || null,
      custoCentavos: data.custoCentavos,
      observacao: data.observacao || null,
      obtidoEm,
      validoAte,
      criadoPor: user.id,
    };
  });

  const created: CostOfferRow[] = [];
  for (let i = 0; i < values.length; i += INSERT_CHUNK) {
    created.push(...(await db.insert(ofertasCusto).values(values.slice(i, i + INSERT_CHUNK)).returning().all()));
  }
  await recordAuditMany(db, created.map((o) => ({ userId: user.id, acao: "oferta_custo.criar", entidade: "oferta_custo", entidadeId: o.id, depois: o })));
  return created;
}

export async function listOffersForProduct(db: Db, user: SessionUser, productId: number) {
  assertCan(user, "cost:view");
  return await db
    .select({
      id: ofertasCusto.id,
      fornecedorId: ofertasCusto.fornecedorId,
      fornecedorNome: fornecedores.nome,
      skuFornecedor: ofertasCusto.skuFornecedor,
      urlProduto: ofertasCusto.urlProduto,
      custoCentavos: ofertasCusto.custoCentavos,
      observacao: ofertasCusto.observacao,
      obtidoEm: ofertasCusto.obtidoEm,
      validoAte: ofertasCusto.validoAte,
    })
    .from(ofertasCusto)
    .innerJoin(fornecedores, eq(fornecedores.id, ofertasCusto.fornecedorId))
    .where(eq(ofertasCusto.produtoId, productId))
    .orderBy(desc(ofertasCusto.obtidoEm), desc(ofertasCusto.id))
    .all();
}
