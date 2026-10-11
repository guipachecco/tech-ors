import Link from "next/link";
import { Alert, Badge, btnPrimary, Card, EmptyState, PageHeader, tdCls, thCls } from "@/ui/primitives";
import { formatDate } from "@/domain/format";
import { formatBRL } from "@/domain/money";
import { requireUser } from "@/app/_shared/session";
import { getDb } from "@/infra/db/client";
import { can } from "@/modules/auth/permissions";
import { expireOverdueQuotes, listPendingApprovals, listQuotes } from "@/modules/quotes/service";

const FILTERS = [
  ["", "Todos"], ["em_elaboracao", "Em elaboração"], ["enviado", "Enviados"],
  ["aprovado", "Aprovados"], ["recusado", "Recusados"], ["expirado", "Expirados"],
] as const;

export default async function OrcamentosPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { status = "" } = await searchParams;
  const db = getDb();
  await expireOverdueQuotes(db);
  const rows = (await listQuotes(db)).filter((q) => !status || q.status === status);
  const pendingApprovals = can(user, "quote:approve") ? await listPendingApprovals(db, user) : [];
  return (
    <>
      <PageHeader title="Orçamentos" actions={<Link href="/orcamentos/novo" className={btnPrimary}>Novo orçamento</Link>} />
      {pendingApprovals.length > 0 && (
        <div className="mb-4">
          <Alert kind="warn">
            <strong>{pendingApprovals.length} orçamento(s) aguardando a sua aprovação:</strong>{" "}
            {pendingApprovals.map((p, i) => (
              <span key={p.id}>{i > 0 && ", "}<Link href={`/orcamentos/${p.id}`} className="font-medium underline">{p.numero}</Link> ({p.clienteNome}, {formatBRL(p.totalCentavos)})</span>
            ))}
          </Alert>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([value, label]) => (
          <Link key={value} href={value ? `/orcamentos?status=${value}` : "/orcamentos"}
            className={`rounded-full border px-3 py-1 text-sm ${status === value ? "border-[var(--btn)] bg-[var(--btn)] text-[#fff]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {label}
          </Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState>Nenhum orçamento por aqui. Clique em “Novo orçamento”.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200"><tr>
                <th className={thCls}>Número</th><th className={thCls}>Cliente</th><th className={thCls}>Status</th>
                <th className={thCls}>Total</th><th className={thCls}>Criado</th><th className={thCls}>Validade</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((q) => {
                  const total = q.totalCentavos;
                  return (
                    <tr key={q.id} className="hover:bg-slate-50">
                      <td className={tdCls}><Link href={`/orcamentos/${q.id}`} className="font-medium text-brand-700 hover:underline">{q.numero}</Link></td>
                      <td className={tdCls}>{q.clienteNome}</td>
                      <td className={tdCls}>
                        <Badge kind={q.status} />
                        {q.status === "em_elaboracao" && q.aprovacaoStatus === "pendente" && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Em aprovação</span>}
                        {q.status === "em_elaboracao" && q.aprovacaoStatus === "aprovada" && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Aprovado internamente</span>}
                      </td>
                      <td className={tdCls}>{formatBRL(total)}</td>
                      <td className={tdCls}>{formatDate(q.criadoEm)}</td>
                      <td className={tdCls}>{formatDate(q.validoAte)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
