"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FIELDS, type Field, type Mapping } from "@/domain/import";
import { guard, intField, optStr, type ActionState } from "@/server/actions";
import { requireCan } from "@/server/auth/current";
import { applyImport, createImport, ImportError, MAX_FILE_BYTES, saveImportMapping } from "@/server/catalog/import";
import { getDb } from "@/server/db/client";

/** Passo 1: recebe a planilha do fornecedor. Nada é gravado no catálogo ainda. */
export async function uploadImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("cost:write");
  let target: string | null = null;
  const result = await guard(async () => {
    const file = fd.get("arquivo");
    if (!(file instanceof File) || file.size === 0) throw new ImportError("Escolha o arquivo .xlsx do fornecedor.");
    if (file.size > MAX_FILE_BYTES) throw new ImportError(`O arquivo passa de ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    if (!/\.xlsx$/i.test(file.name)) throw new ImportError("Use um arquivo .xlsx (no Excel: Salvar como → Pasta de Trabalho do Excel).");
    const rec = await createImport(getDb(), user, {
      fornecedorId: intField(fd, "fornecedorId"),
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    target = `/produtos/importar/${rec.id}`;
  });
  if (target) redirect(target);
  return result;
}

/** Passo 2: associa as colunas da planilha aos campos do sistema (fica salvo para o fornecedor). */
export async function saveMappingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("cost:write");
  const importId = intField(fd, "importId");
  return guard(() => {
    const mapping: Mapping = {};
    for (const f of FIELDS) {
      const h = optStr(fd, `map_${f}`);
      if (h) mapping[f as Field] = h;
    }
    saveImportMapping(getDb(), user, importId, {
      mapping,
      defaults: { categoria: optStr(fd, "padrao_categoria"), fabricante: optStr(fd, "padrao_fabricante") },
    });
    revalidatePath(`/produtos/importar/${importId}`);
    return "Colunas atualizadas. Confira a pré-visualização abaixo.";
  });
}

/** Passo 3: grava no catálogo as linhas marcadas (tudo ou nada). */
export async function applyImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCan("cost:write");
  const importId = intField(fd, "importId");
  let done = false;
  const result = await guard(() => {
    const rows = fd.getAll("linhas").map((v) => Number(v)).filter((n) => Number.isInteger(n));
    applyImport(getDb(), user, importId, rows);
    revalidatePath("/produtos");
    done = true;
  });
  if (done) redirect(`/produtos/importar/${importId}`);
  return result;
}
