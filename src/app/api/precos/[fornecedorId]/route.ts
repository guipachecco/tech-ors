import type { NextRequest } from "next/server";
import { getDb } from "@/infra/db/client";
import { NotFoundError } from "@/infra/validation";
import { checkLoginAllowed, recordLoginFailure } from "@/modules/auth/throttle";
import { MAX_FILE_BYTES } from "@/modules/catalog/import";
import { updateFromFile, verifyPushToken } from "@/modules/catalog/autoprice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Recebe a planilha de um fornecedor (e-mail → automação, Apps Script, curl…) e atualiza o catálogo na hora.
 *   POST /api/precos/{fornecedorId}      Authorization: Bearer <chave do fornecedor>
 *   corpo: o próprio arquivo (.xlsx/.csv) ou multipart com o campo "arquivo". Nome opcional: cabeçalho X-Filename.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ fornecedorId: string }> }) {
  const idRaw = (await ctx.params).fornecedorId;
  if (!/^\d{1,9}$/.test(idRaw)) return json({ erro: "Fornecedor inválido." }, 404);
  const supplierId = Number(idRaw);
  const db = getDb();

  // Chave errada demais bloqueia o IP por 15 min (mesmo mecanismo do login).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  const throttleKey = `push:${supplierId}:${ip}`;
  const gate = await checkLoginAllowed(db, throttleKey);
  if (!gate.allowed) return json({ erro: "Muitas tentativas. Tente de novo mais tarde." }, 429);

  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!(await verifyPushToken(db, supplierId, token))) {
    await recordLoginFailure(db, throttleKey);
    return json({ erro: "Chave inválida." }, 401);
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024) return json({ erro: "Arquivo grande demais (máx. 4 MB)." }, 413);

  let buffer: Buffer;
  let fileName = req.headers.get("x-filename") ?? new URL(req.url).searchParams.get("nome") ?? "planilha";
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = (form.get("arquivo") ?? form.get("file") ?? [...form.values()].find((v) => v instanceof File)) as File | null;
    if (!(file instanceof File)) return json({ erro: "Envie o arquivo no campo “arquivo”." }, 400);
    buffer = Buffer.from(await file.arrayBuffer());
    fileName = file.name || fileName;
  } else {
    buffer = Buffer.from(await req.arrayBuffer());
  }
  if (buffer.length > MAX_FILE_BYTES) return json({ erro: "Arquivo grande demais (máx. 4 MB)." }, 413);

  try {
    const result = await updateFromFile(db, supplierId, { buffer, fileName: fileName.slice(0, 120), origem: "envio" });
    return json({ status: result.status, mensagem: result.mensagem, resumo: result.resumo ?? null }, result.status === "erro" ? 422 : 200);
  } catch (e) {
    if (e instanceof NotFoundError) return json({ erro: "Fornecedor não encontrado." }, 404);
    console.error("Falha ao receber planilha de preços", e);
    return json({ erro: "Erro inesperado." }, 500);
  }
}
