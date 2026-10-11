import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { loadConfig } from "@/infra/config";
import { getDb } from "@/infra/db/client";
import { updateAllSources } from "@/modules/catalog/autoprice";
import { expireOverdueQuotes } from "@/modules/quotes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest, secret: string): boolean {
  const given = Buffer.from(/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "");
  const wanted = Buffer.from(secret);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Rotina agendada (Vercel Cron, ou qualquer agendador que envie `Authorization: Bearer <CRON_SECRET>`):
 * baixa a planilha de cada fornecedor com link configurado, atualiza o catálogo e expira orçamentos vencidos.
 */
export async function GET(req: NextRequest) {
  const secret = loadConfig().cronSecret;
  if (!secret) return Response.json({ erro: "CRON_SECRET não está configurado." }, { status: 503 });
  if (!authorized(req, secret)) return Response.json({ erro: "Não autorizado." }, { status: 401 });

  const db = getDb();
  const fornecedores = await updateAllSources(db);
  const expirados = await expireOverdueQuotes(db);
  return Response.json({ fornecedores, orcamentosExpirados: expirados }, { headers: { "Cache-Control": "no-store" } });
}
