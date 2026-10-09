import { eq } from "drizzle-orm";
import type { Bps, Cents } from "../../domain/money";
import { can } from "../auth/permissions";
import type { SessionUser } from "../auth/sessions";
import { getSettings } from "../catalog/settings";
import type { Db } from "../db/client";
import { clientes } from "../db/schema";
import { computeItem, isItemBelowMinimum, isItemCostExpired, quoteTotals, type Quote, type QuoteItem } from "./guard";
import { getItems, getQuote } from "./service";

/** Item para a tela. Custo e margem só existem para quem tem cost:view. */
export type ItemView = {
  id: number;
  tipo: "produto" | "servico";
  descricao: string;
  quantidade: number;
  precoUnitarioCentavos: Cents;
  descontoBps: Bps;
  totalCentavos: Cents;
  custoVencido: boolean;
  abaixoDoMinimo: boolean;
  custoCentavos?: Cents;
  margemEfetivaBps?: Bps | null;
};

export function toItemViews(items: QuoteItem[], user: SessionUser, now = new Date()): ItemView[] {
  const showCost = can(user, "cost:view");
  return items.map((it) => {
    const c = computeItem(it);
    const view: ItemView = {
      id: it.id,
      tipo: it.tipo,
      descricao: it.descricao,
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
  itens: Array<{ descricao: string; quantidade: number; precoUnitarioCentavos: Cents; descontoBps: Bps; totalCentavos: Cents }>;
  subtotalCentavos: Cents;
  descontoCentavos: Cents;
  freteCentavos: Cents;
  totalCentavos: Cents;
  condicoesPagamento: string;
  prazoEntrega: string;
  garantia: string;
  observacoes: string;
};

export function toClientView(db: Db, quote: Quote, items: QuoteItem[]): QuoteClientView {
  const settings = getSettings(db);
  const client = db.select().from(clientes).where(eq(clientes.id, quote.clienteId)).get()!;
  const totals = quoteTotals(quote, items);
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

export function loadClientView(db: Db, quoteId: number): QuoteClientView {
  return toClientView(db, getQuote(db, quoteId), getItems(db, quoteId));
}
