import { describe, expect, it } from "vitest";
import { canTransition } from "@/domain/quoteStatus";
import { formatQuoteNumber } from "@/domain/quoteNumber";
import { currentCost, defaultValidUntil, isOfferValid, type CostOffer } from "@/domain/costs";

const now = new Date("2026-10-09T12:00:00Z");
const day = 86_400_000;
const offer = (id: number, costCents: number, validDays: number, obtainedDaysAgo = 1, supplierId = 1): CostOffer => ({
  id,
  supplierId,
  costCents,
  obtainedAt: new Date(now.getTime() - obtainedDaysAgo * day),
  validUntil: new Date(now.getTime() + validDays * day),
});

describe("currentCost", () => {
  it("picks the cheapest valid offer", () => {
    const r = currentCost([offer(1, 5000, 3), offer(2, 4000, -1), offer(3, 4500, 2)], now);
    expect(r?.id).toBe(3);
  });
  it("picks the cheapest valid offer across suppliers", () => {
    const r = currentCost([offer(1, 5000, 3, 1, 1), offer(2, 4000, 3, 1, 2), offer(3, 3000, -1, 1, 3)], now);
    expect(r?.id).toBe(2); // o de 3000 venceu
  });
  it("a supplier's newer price replaces its older one, even when the older was cheaper and still valid", () => {
    const r = currentCost([offer(1, 4000, 5, 3), offer(2, 4600, 5, 1)], now); // mesmo fornecedor subiu de 40 para 46
    expect(r?.costCents).toBe(4600);
    // com outro fornecedor mais barato que o novo preço, ele passa a valer
    expect(currentCost([offer(1, 4000, 5, 3), offer(2, 4600, 5, 1), offer(3, 4300, 5, 2, 2)], now)?.id).toBe(3);
  });
  it("when a supplier's latest offer expired, that supplier no longer counts", () => {
    expect(currentCost([offer(1, 4000, 5, 3), offer(2, 4600, -1, 1)], now)).toBeNull();
  });
  it("returns null when nothing is valid", () => {
    expect(currentCost([offer(1, 5000, -1)], now)).toBeNull();
    expect(currentCost([], now)).toBeNull();
  });
  it("breaks ties with the most recent offer", () => {
    expect(currentCost([offer(1, 4000, 3, 5), offer(2, 4000, 3, 1)], now)?.id).toBe(2);
  });
  it("treats expiry exactly at now as expired", () => {
    const o: CostOffer = { ...offer(1, 1, 0), validUntil: now };
    expect(isOfferValid(o, now)).toBe(false);
  });
});

describe("defaultValidUntil", () => {
  it("adds days", () => {
    expect(defaultValidUntil(now, 7).toISOString()).toBe("2026-10-16T12:00:00.000Z");
  });
});

describe("canTransition", () => {
  it("allows the normal flow", () => {
    expect(canTransition("em_elaboracao", "enviado")).toBe(true);
    for (const to of ["aprovado", "recusado", "expirado"] as const) expect(canTransition("enviado", to)).toBe(true);
  });
  it("blocks everything else", () => {
    expect(canTransition("aprovado", "enviado")).toBe(false);
    expect(canTransition("em_elaboracao", "aprovado")).toBe(false);
    expect(canTransition("enviado", "enviado")).toBe(false);
  });
});

describe("formatQuoteNumber", () => {
  it("pads to four digits", () => {
    expect(formatQuoteNumber(2026, 1)).toBe("2026-0001");
    expect(formatQuoteNumber(2026, 12345)).toBe("2026-12345");
  });
});
