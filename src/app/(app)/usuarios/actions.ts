"use server";

import { revalidatePath } from "next/cache";
import { guard, intField, str, type ActionState } from "@/server/actions";
import { requireCan } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { createUser, resetPassword, updateUserAccess } from "@/server/users";

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireCan("user:manage");
  return guard(async () => {
    await createUser(getDb(), admin, {
      nome: str(fd, "nome"),
      email: str(fd, "email"),
      senha: String(fd.get("senha") ?? ""),
      perfil: str(fd, "perfil") === "administrador" ? "administrador" : "vendedor",
      podeVerCusto: fd.get("podeVerCusto") === "on",
    });
    revalidatePath("/usuarios");
    return "Usuário criado.";
  });
}

export async function toggleAccessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireCan("user:manage");
  return guard(() => {
    const field = str(fd, "campo");
    const value = str(fd, "valor") === "1";
    if (field !== "ativo" && field !== "podeVerCusto") return;
    updateUserAccess(getDb(), admin, intField(fd, "id"), { [field]: value });
    revalidatePath("/usuarios");
  });
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireCan("user:manage");
  return guard(async () => {
    await resetPassword(getDb(), admin, intField(fd, "id"), String(fd.get("senha") ?? ""));
    return "Senha redefinida. O usuário precisa entrar novamente.";
  });
}
