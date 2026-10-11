"use server";

import { revalidatePath } from "next/cache";
import { guard, intField, optStr, percentField, str, type ActionState } from "@/app/_shared/actions";
import { requireCan } from "@/app/_shared/session";
import { getDb } from "@/infra/db/client";
import { ValidationError } from "@/infra/validation";
import { MAX_FILE_BYTES } from "@/modules/catalog/import";
import {
  createPushToken, resolvePendingChanges, revokePushToken, saveSource, updateFromFile, updateFromSource, type RunResult,
} from "@/modules/catalog/autoprice";

const done = (r: RunResult) => (r.status === "erro" ? { error: r.mensagem } : { ok: r.mensagem });

export async function saveSourceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("settings:manage");
  return guard(async () => {
    await saveSource(getDb(), user, {
      fornecedorId: intField(fd, "fornecedorId"),
      urlArquivo: optStr(fd, "urlArquivo") ?? "",
      // vazio = manter o que está salvo; para remover, apague o link (o cabeçalho some junto)
      cabecalhoAuth: optStr(fd, "cabecalhoAuth"),
      limiteVariacaoBps: percentField(fd, "limite"),
      ativo: fd.get("ativo") === "on",
    });
    revalidatePath("/precos");
    return "Configuração salva.";
  });
}

export async function generateTokenAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("settings:manage");
  return guard(async () => {
    const token = await createPushToken(getDb(), user, intField(fd, "fornecedorId"));
    revalidatePath("/precos");
    return `Chave criada. Copie agora, ela não será mostrada de novo: ${token}`;
  });
}

export async function revokeTokenAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("settings:manage");
  return guard(async () => {
    await revokePushToken(getDb(), user, intField(fd, "fornecedorId"));
    revalidatePath("/precos");
    return "Chave desativada.";
  });
}

export async function runNowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireCan("cost:write");
  const out: { result?: RunResult } = {};
  const state = await guard(async () => {
    out.result = await updateFromSource(getDb(), intField(fd, "fornecedorId"), "manual");
    revalidatePath("/precos");
    revalidatePath("/produtos");
  });
  return out.result ? done(out.result) : state;
}

export async function uploadAndUpdateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireCan("cost:write");
  const out: { result?: RunResult } = {};
  const state = await guard(async () => {
    const file = fd.get("arquivo");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ arquivo: "Escolha o arquivo" });
    if (file.size > MAX_FILE_BYTES) throw new ValidationError({ arquivo: `O arquivo passa de ${MAX_FILE_BYTES / 1024 / 1024} MB` });
    out.result = await updateFromFile(getDb(), intField(fd, "fornecedorId"), { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, origem: "manual" });
    revalidatePath("/precos");
    revalidatePath("/produtos");
  });
  return out.result ? done(out.result) : state;
}

export async function resolvePendingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("cost:write");
  return guard(async () => {
    const ids = fd.getAll("ids").map((v) => Number(v)).filter((n) => Number.isInteger(n));
    const decision = str(fd, "decisao") === "descartar" ? "descartar" : "aplicar";
    const r = await resolvePendingChanges(getDb(), user, ids, decision);
    revalidatePath("/precos");
    revalidatePath("/produtos");
    return decision === "aplicar" ? `${r.aplicadas} preço(s) aprovado(s) e gravado(s).` : `${r.descartadas} alteração(ões) descartada(s).`;
  });
}
