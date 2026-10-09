"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guard, optStr, str, type ActionState } from "@/app/_shared/actions";
import { requireUser } from "@/app/_shared/session";
import { saveClient } from "@/modules/clients/service";
import { getDb } from "@/infra/db/client";

export async function saveClientAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const idRaw = str(fd, "id");
  let target: string | null = null;
  const result = await guard(async () => {
    const saved = await saveClient(getDb(), user, {
      id: idRaw ? Number(idRaw) : undefined,
      razaoSocial: str(fd, "razaoSocial"),
      cnpj: optStr(fd, "cnpj"),
      contato: optStr(fd, "contato"),
      email: optStr(fd, "email"),
      telefone: optStr(fd, "telefone"),
    });
    revalidatePath("/clientes");
    if (!idRaw) target = `/clientes/${saved.id}`;
    return "Cliente salvo.";
  });
  if (target) redirect(target);
  return result;
}
