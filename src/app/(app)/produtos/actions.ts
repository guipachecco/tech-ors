"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dateField, guard, intField, moneyField, optStr, str, type ActionState } from "@/app/_shared/actions";
import { requireCan, requireUser } from "@/app/_shared/session";
import { addCostOffer } from "@/modules/catalog/costs/service";
import { MAX_PHOTO_BYTES, PhotoError, removeProductPhoto, saveProductPhoto } from "@/modules/catalog/photos/service";
import { saveProduct } from "@/modules/catalog/products/service";
import { getDb } from "@/infra/db/client";

export async function saveProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const idRaw = str(fd, "id");
  let redirectTo: string | null = null;
  const result = await guard(() => {
    const saved = saveProduct(getDb(), user, {
      id: idRaw ? Number(idRaw) : undefined,
      sku: str(fd, "sku"),
      fabricante: str(fd, "fabricante"),
      modelo: str(fd, "modelo"),
      categoria: str(fd, "categoria"),
      descricao: str(fd, "descricao"),
      especificacoes: optStr(fd, "especificacoes"),
    });
    revalidatePath("/produtos");
    if (!idRaw) redirectTo = `/produtos/${saved.id}`;
    return "Produto salvo.";
  });
  if (redirectTo) redirect(redirectTo);
  return result;
}

export async function addOfferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("cost:write");
  const productId = intField(fd, "produtoId");
  const result = await guard(() => {
    addCostOffer(getDb(), user, {
      produtoId: productId,
      fornecedorId: intField(fd, "fornecedorId"),
      custoCentavos: moneyField(fd, "custo"),
      skuFornecedor: optStr(fd, "skuFornecedor"),
      urlProduto: optStr(fd, "urlProduto"),
      observacao: optStr(fd, "observacao"),
      validoAte: dateField(fd, "validoAte"),
    });
    revalidatePath(`/produtos/${productId}`);
    revalidatePath("/produtos");
    return "Custo atualizado.";
  });
  return result;
}

export async function uploadPhotoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const productId = intField(fd, "produtoId");
  return guard(async () => {
    const file = fd.get("foto");
    if (!(file instanceof File) || file.size === 0) throw new PhotoError("Escolha uma foto (JPG, PNG ou WebP).");
    if (file.size > MAX_PHOTO_BYTES) throw new PhotoError(`A foto passa de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
    await saveProductPhoto(getDb(), user, productId, Buffer.from(await file.arrayBuffer()));
    revalidatePath(`/produtos/${productId}`);
    revalidatePath("/produtos");
    return "Foto salva.";
  });
}

export async function removePhotoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const productId = intField(fd, "produtoId");
  return guard(() => {
    removeProductPhoto(getDb(), user, productId);
    revalidatePath(`/produtos/${productId}`);
    revalidatePath("/produtos");
    return "Foto removida.";
  });
}
