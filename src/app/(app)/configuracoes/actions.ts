"use server";

import { revalidatePath } from "next/cache";
import { guard, intField, optStr, percentField, str, type ActionState } from "@/app/_shared/actions";
import { requireCan } from "@/app/_shared/session";
import { deleteMarginRule, saveMarginRule } from "@/modules/catalog/margins/service";
import { saveSettings } from "@/modules/catalog/settings/service";
import { getDb } from "@/infra/db/client";

export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("settings:manage");
  return guard(async () => {
    await saveSettings(getDb(), user, {
      empresaNome: str(fd, "empresaNome"),
      empresaCnpj: str(fd, "empresaCnpj"),
      empresaEndereco: str(fd, "empresaEndereco"),
      empresaTelefone: str(fd, "empresaTelefone"),
      empresaEmail: str(fd, "empresaEmail"),
      validadeCustoDiasPadrao: intField(fd, "validadeCustoDiasPadrao"),
      validadePropostaDias: intField(fd, "validadePropostaDias"),
      impostosBps: percentField(fd, "impostos"),
      margemPadraoBps: percentField(fd, "margemPadrao"),
      margemMinimaPadraoBps: percentField(fd, "margemMinimaPadrao"),
      condicoesPagamento: str(fd, "condicoesPagamento"),
      prazoEntrega: str(fd, "prazoEntrega"),
      garantia: str(fd, "garantia"),
      observacoesPadrao: str(fd, "observacoesPadrao"),
    });
    revalidatePath("/configuracoes");
    return "Configurações salvas.";
  });
}

export async function saveRuleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("margin:manage");
  return guard(async () => {
    const dias = optStr(fd, "validadeCustoDias");
    await saveMarginRule(getDb(), user, {
      escopo: str(fd, "escopo") as "categoria" | "fabricante",
      chave: str(fd, "chave"),
      margemBps: percentField(fd, "margem"),
      margemMinimaBps: percentField(fd, "margemMinima"),
      validadeCustoDias: dias ? intField(fd, "validadeCustoDias") : null,
    });
    revalidatePath("/configuracoes");
    return "Regra salva.";
  });
}

export async function deleteRuleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("margin:manage");
  return guard(async () => {
    await deleteMarginRule(getDb(), user, intField(fd, "id"));
    revalidatePath("/configuracoes");
    return "Regra excluída.";
  });
}
