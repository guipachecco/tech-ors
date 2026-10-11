"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dateField, guard, intField, moneyField, optStr, percentField, str, type ActionState } from "@/app/_shared/actions";
import { requireUser } from "@/app/_shared/session";
import { getDb } from "@/infra/db/client";
import {
  addProductItem, addServiceItem, approveQuote, cancelApproval, createQuote, duplicateQuote, removeItem, repriceItem, repriceQuote,
  regeneratePublicLink, requestApproval, sendQuote, setFrete, setOutcome, updateItem, updateQuoteDetails, getQuote,
} from "@/modules/quotes/service";
import { ValidationError } from "@/infra/validation";

const refresh = (quoteId: number) => {
  revalidatePath(`/orcamentos/${quoteId}`);
  revalidatePath("/orcamentos");
};

export async function createQuoteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let target: string | null = null;
  const result = await guard(async () => {
    const clientId = intField(fd, "clienteId");
    if (!Number.isInteger(clientId)) throw new ValidationError({ clienteId: "Escolha o cliente" });
    target = `/orcamentos/${(await createQuote(getDb(), user, clientId)).id}`;
  });
  if (target) redirect(target);
  return result;
}

export async function addItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await addProductItem(getDb(), user, quoteId, intField(fd, "produtoId"), intField(fd, "quantidade"));
    refresh(quoteId);
  });
}

export async function addServiceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await addServiceItem(getDb(), user, quoteId, {
      descricao: str(fd, "descricao"),
      quantidade: intField(fd, "quantidade"),
      precoUnitarioCentavos: moneyField(fd, "preco"),
    });
    refresh(quoteId);
    return "Serviço adicionado.";
  });
}

export async function updateItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await updateItem(getDb(), user, intField(fd, "itemId"), {
      quantidade: intField(fd, "quantidade"),
      descontoBps: percentField(fd, "desconto"),
    });
    refresh(quoteId);
  });
}

export async function removeItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await removeItem(getDb(), user, intField(fd, "itemId"));
    refresh(quoteId);
  });
}

export async function repriceItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await repriceItem(getDb(), user, intField(fd, "itemId"));
    refresh(quoteId);
  });
}

export async function setFreteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await setFrete(getDb(), user, quoteId, str(fd, "frete") ? moneyField(fd, "frete") : 0);
    refresh(quoteId);
  });
}

export async function updateDetailsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    const validoAte = dateField(fd, "validoAte");
    if (!validoAte) throw new ValidationError({ validoAte: "Informe a validade" });
    await updateQuoteDetails(getDb(), user, quoteId, {
      condicoesPagamento: str(fd, "condicoesPagamento"),
      prazoEntrega: str(fd, "prazoEntrega"),
      garantia: str(fd, "garantia"),
      observacoes: str(fd, "observacoes"),
      validoAte,
    });
    refresh(quoteId);
    return "Condições salvas.";
  });
}

export async function sendAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await sendQuote(getDb(), user, quoteId, { justificativa: optStr(fd, "justificativa") });
    refresh(quoteId);
    return "Orçamento marcado como enviado.";
  });
}

export async function outcomeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    const outcome = str(fd, "resultado") === "aprovado" ? "aprovado" : "recusado";
    await setOutcome(getDb(), user, quoteId, outcome, optStr(fd, "motivo"));
    refresh(quoteId);
  });
}

export async function repriceAllAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    const changes = await repriceQuote(getDb(), user, quoteId);
    refresh(quoteId);
    const semCusto = changes.filter((c) => c.precoDepoisCentavos === null).length;
    const alterados = changes.length - semCusto;
    if (changes.length === 0) return "Os preços já estão atualizados.";
    return [alterados ? `${alterados} preço(s) atualizado(s).` : "", semCusto ? `${semCusto} item(ns) sem custo válido: atualize o custo no produto.` : ""].filter(Boolean).join(" ");
  });
}

export async function requestApprovalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await requestApproval(getDb(), user, quoteId);
    refresh(quoteId);
    return "Pedido de aprovação enviado.";
  });
}

export async function approveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    const enviar = str(fd, "enviar") === "1";
    await approveQuote(getDb(), user, quoteId, { enviar, justificativa: optStr(fd, "justificativa") });
    refresh(quoteId);
    return enviar ? "Orçamento aprovado e marcado como enviado." : "Orçamento aprovado.";
  });
}

export async function cancelApprovalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await cancelApproval(getDb(), user, quoteId, optStr(fd, "nota"));
    refresh(quoteId);
    return "Orçamento liberado para edição.";
  });
}

export async function regenerateLinkAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const quoteId = intField(fd, "orcamentoId");
  return guard(async () => {
    await regeneratePublicLink(getDb(), user, quoteId);
    refresh(quoteId);
    return "Link novo criado. O anterior deixou de funcionar.";
  });
}

export async function duplicateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let target: string | null = null;
  const result = await guard(async () => {
    const id = intField(fd, "orcamentoId");
    await getQuote(getDb(), id);
    target = `/orcamentos/${(await duplicateQuote(getDb(), user, id)).id}`;
  });
  if (target) redirect(target);
  return result;
}
