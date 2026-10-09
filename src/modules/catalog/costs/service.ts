import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { defaultValidUntil } from "../../../domain/costs";
import { recordAudit } from "../../../infra/audit";
import { assertCan } from "../../auth/permissions";
import type { SessionUser } from "../../auth/sessions";
import type { Db } from "../../../infra/db/client";
import { fornecedores, ofertasCusto, produtos } from "../../../infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "../../../infra/validation";
import { resolveRule } from "../margins/service";
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

/** Cada atualização cria uma nova linha: o histórico de custos é preservado. */
export function addCostOffer(db: Db, user: SessionUser, input: z.input<typeof offerSchema>, now = new Date()): CostOfferRow {
  assertCan(user, "cost:write");
  const data = parseInput(offerSchema, input);
  const product = db.select().from(produtos).where(eq(produtos.id, data.produtoId)).get();
  if (!product) throw new NotFoundError("Produto");
  const supplier = db.select().from(fornecedores).where(eq(fornecedores.id, data.fornecedorId)).get();
  if (!supplier) throw new NotFoundError("Fornecedor");

  const obtidoEm = data.obtidoEm ?? now;
  const validoAte = data.validoAte ?? defaultValidUntil(obtidoEm, resolveRule(db, product).validadeCustoDias);
  if (validoAte.getTime() <= obtidoEm.getTime()) {
    throw new ValidationError({ validoAte: "A validade deve ser depois da data do preço" });
  }

  const created = db
    .insert(ofertasCusto)
    .values({
      produtoId: data.produtoId,
      fornecedorId: data.fornecedorId,
      skuFornecedor: data.skuFornecedor || null,
      urlProduto: data.urlProduto || null,
      custoCentavos: data.custoCentavos,
      observacao: data.observacao || null,
      obtidoEm,
      validoAte,
      criadoPor: user.id,
    })
    .returning()
    .get();
  recordAudit(db, { userId: user.id, acao: "oferta_custo.criar", entidade: "oferta_custo", entidadeId: created.id, depois: created });
  return created;
}

export function listOffersForProduct(db: Db, user: SessionUser, productId: number) {
  assertCan(user, "cost:view");
  return db
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
