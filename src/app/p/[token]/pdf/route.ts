import { getDb } from "@/infra/db/client";
import { buildQuotePdf, findLogo } from "@/modules/exports/pdf";
import { getItems, getQuoteByToken } from "@/modules/quotes/service";
import { toClientView } from "@/modules/quotes/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PDF do orçamento para o cliente que tem o link (sem custo nem margem, como o PDF interno). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const db = getDb();
  const quote = await getQuoteByToken(db, (await ctx.params).token);
  if (!quote) return new Response("Não encontrado", { status: 404 });
  const view = await toClientView(db, quote, await getItems(db, quote.id));
  const buf = await buildQuotePdf(view, { logoPath: findLogo() });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="orcamento-${quote.numero}.pdf"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
