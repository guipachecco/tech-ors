import { buildQuotePdf, findLogo } from "@/modules/exports/pdf";
import { prepareExport } from "../export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const prepared = await prepareExport((await ctx.params).id, "pdf");
  if (prepared instanceof Response) return prepared;
  const buf = await buildQuotePdf(prepared.view, { logoPath: findLogo() });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${prepared.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
