export class NoValidCostError extends Error {
  constructor() {
    super("Este produto não tem custo válido. Atualize o custo antes de adicionar ao orçamento.");
    this.name = "NoValidCostError";
  }
}

export class QuoteLockedError extends Error {
  constructor() {
    super("Só é possível alterar orçamentos em elaboração.");
    this.name = "QuoteLockedError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Não é possível mudar o orçamento de "${from}" para "${to}".`);
    this.name = "InvalidTransitionError";
  }
}

export type SendBlockReason = "sem_itens" | "validade_vencida" | "custo_vencido" | "margem_abaixo_minimo";

export class SendBlockedError extends Error {
  readonly motivos: SendBlockReason[];
  constructor(motivos: SendBlockReason[], detail?: string) {
    super(detail ?? `Envio bloqueado: ${motivos.join(", ")}`);
    this.name = "SendBlockedError";
    this.motivos = motivos;
  }
}
