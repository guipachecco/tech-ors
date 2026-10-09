export const QUOTE_STATUSES = ["em_elaboracao", "enviado", "aprovado", "recusado", "expirado"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const ALLOWED: Record<QuoteStatus, QuoteStatus[]> = {
  em_elaboracao: ["enviado"],
  enviado: ["aprovado", "recusado", "expirado"],
  aprovado: [],
  recusado: [],
  expirado: [],
};

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return ALLOWED[from].includes(to);
}
