"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guard, optStr, str, type ActionState } from "@/server/actions";
import { requireUser } from "@/server/auth/current";
import { saveSupplier } from "@/server/catalog/suppliers";
import { getDb } from "@/server/db/client";

export async function saveSupplierAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const idRaw = str(fd, "id");
  let done = false;
  const result = await guard(() => {
    saveSupplier(getDb(), user, {
      id: idRaw ? Number(idRaw) : undefined,
      nome: str(fd, "nome"),
      site: optStr(fd, "site"),
      observacoes: optStr(fd, "observacoes"),
    });
    revalidatePath("/fornecedores");
    done = true;
    return "Fornecedor salvo.";
  });
  if (done) redirect("/fornecedores");
  return result;
}
