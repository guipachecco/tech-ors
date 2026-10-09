"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guard, optStr, str, type ActionState } from "@/app/_shared/actions";
import { requireUser } from "@/app/_shared/session";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import { getDb } from "@/infra/db/client";

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
