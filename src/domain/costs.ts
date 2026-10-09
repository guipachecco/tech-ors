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

/** Oferta vigente: a mais barata ainda válida; empate → a mais recente. */
export function currentCost(offers: CostOffer[], now: Date): CostOffer | null {
  let best: CostOffer | null = null;
  for (const o of offers) {
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
