import type { Cents } from "./money";

export type CostOffer = {
  id: number;
  supplierId: number;
  costCents: Cents;
  obtainedAt: Date;
  validUntil: Date;
};

export function isOfferValid(o: CostOffer, now: Date): boolean {
  return o.validUntil.getTime() > now.getTime();
}

const isNewer = (a: CostOffer, b: CostOffer) => a.obtainedAt.getTime() > b.obtainedAt.getTime() || (a.obtainedAt.getTime() === b.obtainedAt.getTime() && a.id > b.id);

/**
 * Oferta vigente: a mais barata entre os fornecedores, ainda válida; empate → a mais recente.
 * Cada fornecedor vale pelo que informou por último: o preço novo dele substitui o anterior, mesmo que o
 * anterior fosse mais barato e ainda não tivesse vencido (senão um aumento do fornecedor só apareceria dias depois).
 */
export function currentCost(offers: CostOffer[], now: Date): CostOffer | null {
  const latestBySupplier = new Map<number, CostOffer>();
  for (const o of offers) {
    const cur = latestBySupplier.get(o.supplierId);
    if (!cur || isNewer(o, cur)) latestBySupplier.set(o.supplierId, o);
  }
  let best: CostOffer | null = null;
  for (const o of latestBySupplier.values()) {
    if (!isOfferValid(o, now)) continue;
    if (
      best === null ||
      o.costCents < best.costCents ||
      (o.costCents === best.costCents && o.obtainedAt.getTime() > best.obtainedAt.getTime())
    ) {
      best = o;
    }
  }
  return best;
}

export function defaultValidUntil(obtainedAt: Date, days: number): Date {
  return new Date(obtainedAt.getTime() + days * 86_400_000);
}
