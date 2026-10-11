import type { Bps, Cents } from "./money";

/** Variação absoluta entre dois custos, em pontos-base do custo anterior (1% = 100). */
export function variationBps(previous: Cents, next: Cents): Bps {
  if (previous <= 0) return next === previous ? 0 : Number.MAX_SAFE_INTEGER;
  return Math.round((Math.abs(next - previous) * 10_000) / previous);
}

/** Variação acima do limite não entra sozinha no catálogo: espera a revisão de uma pessoa. */
export function needsReview(previous: Cents, next: Cents, limitBps: Bps): boolean {
  return variationBps(previous, next) > limitBps;
}
