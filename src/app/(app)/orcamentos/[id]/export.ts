import { recordAudit } from "@/infra/audit";
import { getCurrentUser } from "@/app/_shared/session";
import { getDb } from "@/infra/db/client";
import { NotFoundError } from "@/infra/validation";
import { getQuote } from "@/modules/quotes/service";
import { loadClientView, type QuoteClientView } from "@/modules/quotes/views";

/** Carrega a visão do cliente para exportação; devolve a resposta de erro se não houver acesso. */
export async function prepareExport(
  idRaw: string,
  kind: "pdf" | "xlsx",
): Promise<{ view: QuoteClientView; filename: string } | Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autenticado", { status: 401 });
  const id = Number(idRaw);
  if (!Number.isInteger(id)) return new Response("Não encontrado", { status: 404 });
  const db = getDb();
  try {
    const quote = getQuote(db, id);
    const view = loadClientView(db, id);
    recordAudit(db, { userId: user.id, acao: `orcamento.exportar_${kind}`, entidade: "orcamento", entidadeId: id });
    return { view, filename: `orcamento-${quote.numero}.${kind}` };
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Não encontrado", { status: 404 });
    throw e;
  }
}
