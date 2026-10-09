"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/app/_shared/actions";
import { requireUser } from "@/app/_shared/session";
import { applyPhotoByName, matchPhotoNames, type PhotoBatchResult, type PhotoMatch } from "@/modules/catalog/photos/match";
import { MAX_PHOTO_BYTES, PhotoError } from "@/modules/catalog/photos/service";
import { getDb } from "@/infra/db/client";

const MAX_NAMES = 3000;

/** Prévia: diz a quais produtos cada nome de arquivo corresponde. Não grava nada. */
export async function previewPhotoNamesAction(names: string[]): Promise<PhotoMatch[]> {
  await requireUser();
  if (!Array.isArray(names) || names.length > MAX_NAMES) return [];
  const clean = names.map((n) => String(n).slice(0, 255));
  return await matchPhotoNames(getDb(), clean);
}

export type UploadResult = ({ ok: true } & PhotoBatchResult) | { ok: false; error: string };

/** Envia UMA foto (o navegador chama uma vez por arquivo, em sequência) e aplica aos produtos do nome. */
export async function uploadPhotoByNameAction(fd: FormData): Promise<UploadResult> {
  const user = await requireUser();
  let data: PhotoBatchResult | null = null;
  const state = await guard(async () => {
    const file = fd.get("foto");
    if (!(file instanceof File) || file.size === 0) throw new PhotoError("Arquivo vazio.");
    if (file.size > MAX_PHOTO_BYTES) throw new PhotoError(`A foto passa de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
    const nome = String(fd.get("nome") ?? "").slice(0, 255);
    data = await applyPhotoByName(getDb(), user, nome, Buffer.from(await file.arrayBuffer()), { replace: fd.get("substituir") === "1" });
  });
  if (data) {
    revalidatePath("/produtos");
    return { ok: true, ...(data as PhotoBatchResult) };
  }
  return { ok: false, error: state?.error ?? "Erro ao enviar a foto." };
}
