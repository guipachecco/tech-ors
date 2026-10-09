import { InvalidMoneyError, parseBRL, parsePercentBps } from "../domain/money";
import { ForbiddenError } from "./auth/permissions";
import { ImportError } from "./catalog/import";
import { PhotoError } from "./catalog/photos";
import { InvalidTransitionError, NoValidCostError, QuoteLockedError, SendBlockedError } from "./quotes/errors";
import { NotFoundError, ValidationError } from "./validation";

export type ActionState = { error?: string; ok?: string } | null;

const FIELD_LABELS: Record<string, string> = {
  sku: "SKU", fabricante: "Fabricante", modelo: "Modelo", categoria: "Categoria", razaoSocial: "Razão social",
  cnpj: "CNPJ", email: "E-mail", nome: "Nome", custoCentavos: "Custo", validoAte: "Validade", urlProduto: "Link",
  margemBps: "Margem", margemMinimaBps: "Margem mínima", impostosBps: "Impostos", quantidade: "Quantidade",
  motivo: "Motivo", site: "Site", senha: "Senha",
};

/** Executa uma ação convertendo erros conhecidos em mensagens para a tela. */
export async function guard(fn: () => Promise<string | void> | string | void): Promise<ActionState> {
  try {
    const ok = await fn();
    return { ok: ok || undefined };
  } catch (e) {
    if (e instanceof ValidationError) {
      const parts = Object.entries(e.fields).map(([k, v]) => (k === "_" ? v : `${FIELD_LABELS[k] ?? k}: ${v}`));
      return { error: parts.join(" · ") };
    }
    if (
      e instanceof InvalidMoneyError || e instanceof ForbiddenError || e instanceof NoValidCostError ||
      e instanceof QuoteLockedError || e instanceof InvalidTransitionError || e instanceof SendBlockedError || e instanceof ImportError || e instanceof PhotoError ||
      e instanceof NotFoundError
    ) {
      return { error: e.message };
    }
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    console.error("Erro inesperado na ação:", e);
    return { error: "Erro inesperado. Tente novamente." };
  }
}

export const str = (fd: FormData, key: string): string => String(fd.get(key) ?? "").trim();
export const optStr = (fd: FormData, key: string): string | undefined => str(fd, key) || undefined;
export const intField = (fd: FormData, key: string): number => {
  const v = str(fd, key);
  return /^\d+$/.test(v) ? Number(v) : NaN;
};
export const moneyField = (fd: FormData, key: string): number => parseBRL(str(fd, key));
export const percentField = (fd: FormData, key: string): number => parsePercentBps(str(fd, key));

export function dateField(fd: FormData, key: string): Date | undefined {
  const v = str(fd, key);
  if (!v) return undefined;
  const d = new Date(`${v}T23:59:59-03:00`);
  if (Number.isNaN(d.getTime())) throw new ValidationError({ [key]: "Data inválida" });
  return d;
}
