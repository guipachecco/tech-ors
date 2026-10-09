import { eq, inArray } from "drizzle-orm";
import type { Bps, Cents } from "@/domain/money";
import { can } from "../auth/permissions";
import type { SessionUser } from "../auth/sessions";
import { getSettings } from "../catalog/settings/service";
import type { Db } from "@/infra/db/client";
import { getProductPhotos } from "../catalog/photos/service";
import { clientes, produtos } from "@/infra/db/schema";
import { computeItem, isItemBelowMinimum, isItemCostExpired, quoteTotals, type Quote, type QuoteItem } from "./guard";
import { getItems, getQuote } from "./service";

/** Item para a tela. Custo e margem só existem para quem tem cost:view. */
export type ItemView = {
  id: number;
  tipo: "produto" | "servico";
  descricao: string;
  detalhes: string;
  produtoId: number | null;
  /** Versão da foto do produto (null = sem foto); usada na URL da miniatura. */
  fotoVersao: number | null;
  quantidade: number;
  precoUnitarioCentavos: Cents;
  descontoBps: Bps;
  totalCentavos: Cents;
  custoVencido: boolean;
  abaixoDoMinimo: boolean;
  custoCentavos?: Cents;
  margemEfetivaBps?: Bps | null;
};

export function toItemViews(items: QuoteItem[], user: SessionUser, now = new Date(), photoVersions: Map<number, number> = new Map()): ItemView[] {
  const showCost = can(user, "cost:view");
  return items.map((it) => {
    const c = computeItem(it);
    const view: ItemView = {
      id: it.id,
      tipo: it.tipo,
      descricao: it.descricao,
      detalhes: it.detalhes,
      produtoId: it.produtoId,
      fotoVersao: it.produtoId !== null ? (photoVersions.get(it.produtoId) ?? null) : null,
      quantidade: it.quantidade,
      precoUnitarioCentavos: it.precoUnitarioCentavos,
      descontoBps: it.descontoBps,
      totalCentavos: c.netCentavos,
      custoVencido: isItemCostExpired(it, now),
      abaixoDoMinimo: isItemBelowMinimum(it),
    };
    if (showCost && it.tipo === "produto") {
      view.custoCentavos = it.custoCentavos;
      view.margemEfetivaBps = c.marginBps;
    }
    return view;
  });
}

/** Visão enviada ao cliente (PDF/XLSX). Não possui nenhum campo de custo ou margem. */
export type QuoteClientView = {
  numero: string;
  emitidoEm: Date;
  validoAte: Date;
  empresa: { nome: string; cnpj: string; endereco: string; telefone: string; email: string };
  cliente: { razaoSocial: string; cnpj: string | null; contato: string | null; email: string | null; telefone: string | null };
  itens: Array<{ descricao: string; detalhes: string; foto?: Buffer; quantidade: number; precoUnitarioCentavos: Cents; descontoBps: Bps; totalCentavos: Cents }>;
  subtotalCentavos: Cents;
  descontoCentavos: Cents;
  freteCentavos: Cents;
  totalCentavos: Cents;
  condicoesPagamento: string;
  prazoEntrega: string;
  garantia: string;
  observacoes: string;
};

export async function toClientView(db: Db, quote: Quote, items: QuoteItem[]): Promise<QuoteClientView> {
  const settings = await getSettings(db);
  const client = (await db.select().from(clientes).where(eq(clientes.id, quote.clienteId)).get())!;
  const totals = quoteTotals(quote, items);
  const photos = await getProductPhotos(db, items.flatMap((i) => (i.produtoId !== null ? [i.produtoId] : [])));
  return {
    numero: quote.numero,
    emitidoEm: quote.criadoEm,
    validoAte: quote.validoAte,
    empresa: {
      nome: settings.empresaNome,
      cnpj: settings.empresaCnpj,
      endereco: settings.empresaEndereco,
      telefone: settings.empresaTelefone,
      email: settings.empresaEmail,
    },
    cliente: {
      razaoSocial: client.razaoSocial,
      cnpj: client.cnpj,
      contato: client.contato,
      email: client.email,
      telefone: client.telefone,
    },
    itens: items.map((it) => ({
      descricao: it.descricao,
      detalhes: it.detalhes,
      foto: it.produtoId !== null ? photos.get(it.produtoId) : undefined,
      quantidade: it.quantidade,
      precoUnitarioCentavos: it.precoUnitarioCentavos,
      descontoBps: it.descontoBps,
      totalCentavos: computeItem(it).netCentavos,
    })),
    ...totals,
    condicoesPagamento: quote.condicoesPagamento,
    prazoEntrega: quote.prazoEntrega,
    garantia: quote.garantia,
    observacoes: quote.observacoes,
  };
}

export async function loadClientView(db: Db, quoteId: number): Promise<QuoteClientView> {
  return await toClientView(db, await getQuote(db, quoteId), await getItems(db, quoteId));
}

/** Versões das fotos dos produtos do orçamento (produto → versão), para as miniaturas da tela. */
export async function photoVersionsFor(db: Db, items: QuoteItem[]): Promise<Map<number, number>> {
  const ids = [...new Set(items.flatMap((i) => (i.produtoId !== null ? [i.produtoId] : [])))];
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = await db.select({ id: produtos.id, v: produtos.fotoVersao }).from(produtos).where(inArray(produtos.id, ids)).all();
  for (const p of rows) if (p.v !== null) out.set(p.id, p.v);
  return out;
}
