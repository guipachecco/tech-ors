"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { guard, str, type ActionState } from "@/app/_shared/actions";
import { getDb } from "@/infra/db/client";
import { respondAsClient } from "@/modules/quotes/service";

/** O cliente aprova ou recusa pelo link. Sem login: o código secreto do link é a credencial. */
export async function respondAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, "token");
  const resultado = str(fd, "resultado") === "recusado" ? "recusado" : "aprovado";
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return guard(async () => {
    await respondAsClient(getDb(), token, { resultado, nome: str(fd, "nome"), motivo: str(fd, "motivo") }, { ip });
    revalidatePath(`/p/${token}`);
    revalidatePath("/orcamentos");
  });
}
