import { belowMinimum, lineMarginBps, lineNetCents } from "@/domain/pricing";
import type { Bps, Cents } from "@/domain/money";
import type { orcamentoItens, orcamentos } from "@/infra/db/schema";
import type { SendBlockReason } from "./errors";

export type Quote = typeof orcamentos.$inferSelect;
export type QuoteItem = typeof orcamentoItens.$inferSelect;

export type ItemComputed = { grossCentavos: Cents; netCentavos: Cents; marginBps: Bps | null };

export function computeItem(item: QuoteItem): ItemComputed {
  const gross = item.precoUnitarioCentavos * item.quantidade;
  const net = lineNetCents(item.precoUnitarioCentavos, item.quantidade, item.descontoBps);
  const marginBps = item.tipo === "produto" ? lineMarginBps(item.custoCentavos, item.quantidade, net, item.impostosBps) : null;
  return { grossCentavos: gross, netCentavos: net, marginBps };
}

export function quoteTotals(quote: Pick<Quote, "freteCentavos">, items: QuoteItem[]) {
  let subtotal = 0;
  let net = 0;
  for (const it of items) {
    const c = computeItem(it);
    subtotal += c.grossCentavos;
    net += c.netCentavos;
  }
  return {
    subtotalCentavos: subtotal,
    descontoCentavos: subtotal - net,
    freteCentavos: quote.freteCentavos,
    totalCentavos: net + quote.freteCentavos,
  };
}

export function isItemCostExpired(item: QuoteItem, now: Date): boolean {
  return item.tipo === "produto" && (item.custoValidoAte === null || item.custoValidoAte.getTime() <= now.getTime());
}

export function isItemBelowMinimum(item: QuoteItem): boolean {
  if (item.tipo !== "produto") return false;
  return belowMinimum(computeItem(item).marginBps, item.margemMinimaBps);
}

export const OVERRIDABLE: SendBlockReason[] = ["custo_vencido", "margem_abaixo_minimo"];

export function checkSendable(quote: Quote, items: QuoteItem[], now: Date): { ok: true } | { ok: false; motivos: SendBlockReason[] } {
  const motivos: SendBlockReason[] = [];
  if (items.length === 0) motivos.push("sem_itens");
  if (quote.validoAte.getTime() <= now.getTime()) motivos.push("validade_vencida");
  if (items.some((i) => isItemCostExpired(i, now))) motivos.push("custo_vencido");
  if (items.some((i) => isItemBelowMinimum(i))) motivos.push("margem_abaixo_minimo");
  return motivos.length === 0 ? { ok: true } : { ok: false, motivos };
}
