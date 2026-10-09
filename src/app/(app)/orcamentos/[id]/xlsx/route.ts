import { buildQuoteXlsx } from "@/modules/exports/xlsx";
import { prepareExport } from "../export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const prepared = await prepareExport((await ctx.params).id, "xlsx");
  if (prepared instanceof Response) return prepared;
  const buf = await buildQuoteXlsx(prepared.view);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${prepared.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
