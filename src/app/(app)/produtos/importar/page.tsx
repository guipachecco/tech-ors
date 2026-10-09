import Link from "next/link";
import { ActionForm } from "@/ui/ActionForm";
import { Alert, Card, Field, inputCls, PageHeader } from "@/ui/primitives";
import { requireCan } from "@/app/_shared/session";
import { MAX_FILE_BYTES, MAX_ROWS } from "@/modules/catalog/import/service";
import { listSuppliers } from "@/modules/catalog/suppliers/service";
import { getDb } from "@/infra/db/client";
import { uploadImportAction } from "./actions";

export default async function ImportarPage() {
  await requireCan("cost:write");
  const suppliers = listSuppliers(getDb());
  return (
    <>
      <PageHeader title="Importar planilha de fornecedor" subtitle="Atualize custos e cadastre produtos a partir do arquivo que o fornecedor enviou" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="1. Envie o arquivo" className="lg:col-span-2">
          {suppliers.length === 0 ? (
            <Alert kind="info">Cadastre o fornecedor primeiro. <Link href="/fornecedores" className="font-medium underline">Ir para Fornecedores</Link></Alert>
          ) : (
            <ActionForm action={uploadImportAction} submitLabel="Enviar e continuar" className="space-y-5">
              <Field label="Fornecedor que enviou a planilha" name="fornecedorId">
                <select id="fornecedorId" name="fornecedorId" required className={inputCls}>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </Field>
              <Field label="Planilha (.xlsx)" name="arquivo" hint={`Até ${MAX_FILE_BYTES / 1024 / 1024} MB e ${MAX_ROWS.toLocaleString("pt-BR")} linhas. Nada é gravado até você confirmar.`}>
                <input id="arquivo" name="arquivo" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-[var(--btn)] file:px-3 file:py-1 file:text-sm file:font-medium file:text-[#fff]`} />
              </Field>
            </ActionForm>
          )}
        </Card>
        <Card title="Como funciona">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
            <li>Escolha o fornecedor e envie a planilha dele, no formato que ele mandou.</li>
            <li>Confira se as colunas foram reconhecidas (código, descrição, custo…). O sistema lembra a escolha para a próxima planilha desse fornecedor.</li>
            <li>Veja o que será criado, atualizado ou reconfirmado, desmarque o que não quiser e confirme.</li>
          </ol>
          <p className="mt-4 text-xs text-slate-500">
            Cada importação cria um novo custo no histórico (nunca sobrescreve). O produto é reconhecido pelo código do fornecedor ou pelo SKU interno.
          </p>
        </Card>
      </div>
    </>
  );
}
