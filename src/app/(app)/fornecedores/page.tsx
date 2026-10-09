import Link from "next/link";
import { ActionForm } from "@/ui/ActionForm";
import { Card, EmptyState, Field, PageHeader, tdCls, TextInput, thCls } from "@/ui/primitives";
import { requireUser } from "@/app/_shared/session";
import { listSuppliers } from "@/modules/catalog/suppliers/service";
import { getDb } from "@/infra/db/client";
import { saveSupplierAction } from "./actions";

export default async function FornecedoresPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requireUser();
  const { edit } = await searchParams;
  const suppliers = await listSuppliers(getDb());
  const editing = edit ? suppliers.find((s) => s.id === Number(edit)) : undefined;
  return (
    <>
      <PageHeader title="Fornecedores" subtitle="Onde você consulta os preços de custo" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={editing ? `Editar: ${editing.nome}` : "Novo fornecedor"} className="lg:col-span-1">
          <ActionForm action={saveSupplierAction} key={editing?.id ?? "new"} className="space-y-4" submitLabel={editing ? "Salvar" : "Adicionar"}
            secondary={editing ? <Link href="/fornecedores" className="text-sm text-slate-600 hover:underline">Cancelar</Link> : undefined}>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <Field label="Nome" name="nome"><TextInput name="nome" defaultValue={editing?.nome} required /></Field>
            <Field label="Site" name="site"><TextInput name="site" type="url" placeholder="https://…" defaultValue={editing?.site ?? ""} /></Field>
            <Field label="Observações" name="observacoes"><TextInput name="observacoes" defaultValue={editing?.observacoes ?? ""} /></Field>
          </ActionForm>
        </Card>
        <Card className="lg:col-span-2">
          {suppliers.length === 0 ? <EmptyState>Nenhum fornecedor cadastrado.</EmptyState> : (
            <table className="w-full">
              <thead className="border-b border-slate-200"><tr><th className={thCls}>Nome</th><th className={thCls}>Site</th><th className={thCls}></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className={tdCls}>{s.nome}</td>
                    <td className={tdCls}>{s.site ? <a href={s.site} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{s.site}</a> : "—"}</td>
                    <td className={`${tdCls} text-right`}><Link href={`/fornecedores?edit=${s.id}`} className="text-brand-700 hover:underline">Editar</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
