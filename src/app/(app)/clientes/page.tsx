import Link from "next/link";
import { Card, EmptyState, btnPrimary, btnSecondary, inputCls, PageHeader, tdCls, thCls } from "@/components/ui";
import { formatCnpj } from "@/domain/cnpj";
import { requireUser } from "@/server/auth/current";
import { searchClients } from "@/server/clients";
import { getDb } from "@/server/db/client";

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const { q = "" } = await searchParams;
  const clients = searchClients(getDb(), q, 200);
  return (
    <>
      <PageHeader title="Clientes" actions={<Link href="/clientes/novo" className={btnPrimary}>Novo cliente</Link>} />
      <Card>
        <form className="mb-4 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Buscar por nome, CNPJ ou contato…" className={inputCls} />
          <button className={btnSecondary}>Buscar</button>
        </form>
        {clients.length === 0 ? <EmptyState>Nenhum cliente encontrado.</EmptyState> : (
          <table className="w-full">
            <thead className="border-b border-slate-200"><tr><th className={thCls}>Razão social</th><th className={thCls}>CNPJ</th><th className={thCls}>Contato</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className={tdCls}><Link href={`/clientes/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.razaoSocial}</Link></td>
                  <td className={tdCls}>{c.cnpj ? formatCnpj(c.cnpj) : "—"}</td>
                  <td className={tdCls}>{c.contato ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
