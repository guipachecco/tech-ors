import { createHash } from "node:crypto";
import { getCurrentUser } from "@/server/auth/current";
import { getProductPhoto } from "@/server/catalog/photos";
import { getDb } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Foto do produto. Só para quem está logado; o navegador guarda em cache (a URL muda quando a foto muda). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Não autenticado", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return new Response("Não encontrado", { status: 404 });
  const photo = getProductPhoto(getDb(), id);
  if (!photo) return new Response("Não encontrado", { status: 404 });

  const etag = `"${createHash("sha1").update(photo.data).digest("hex")}"`;
  const headers = {
    "Content-Type": "image/jpeg",
    "Content-Disposition": "inline",
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(photo.data), { headers });
}
