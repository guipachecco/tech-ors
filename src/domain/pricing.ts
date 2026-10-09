import type { Bps, Cents } from "./money";

const BASE = 10000;

function assertNonNegInt(n: number, label: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${label} inválido: ${n}`);
}

/** preço = custo / (1 − margem − impostos), arredondado para cima ao centavo. */
export function salePriceCents(cost: Cents, marginBps: Bps, taxBps: Bps): Cents {
  assertNonNegInt(cost, "custo");
  assertNonNegInt(marginBps, "margem");
  assertNonNegInt(taxBps, "impostos");
  const den = BASE - marginBps - taxBps;
  if (den <= 0) throw new RangeError("margem + impostos deve ser menor que 100%");
  const num = BigInt(cost) * BigInt(BASE);
  const d = BigInt(den);
  return Number((num + d - 1n) / d);
}

/** Valor líquido da linha: preço × quantidade − desconto (arredondado ao centavo). */
export function lineNetCents(unit: Cents, qty: number, discountBps: Bps): Cents {
  assertNonNegInt(unit, "preço unitário");
  assertNonNegInt(qty, "quantidade");
  assertNonNegInt(discountBps, "desconto");
  if (discountBps > BASE) throw new RangeError("desconto maior que 100%");
  const gross = BigInt(unit) * BigInt(qty);
  const discount = (gross * BigInt(discountBps) + 5000n) / 10000n;
  return Number(gross - discount);
}

/** Margem efetiva da linha (sobre o líquido, já descontados impostos). `null` se o líquido for zero. */
export function lineMarginBps(costUnit: Cents, qty: number, netCents: Cents, taxBps: Bps): Bps | null {
  if (netCents <= 0) return null;
  return Math.round(BASE - taxBps - (costUnit * qty * BASE) / netCents);
}

export function belowMinimum(marginBps: Bps | null, minBps: Bps): boolean {
  return marginBps === null || marginBps < minBps;
}
