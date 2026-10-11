import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/ui/ActionForm";
import { Logo } from "@/ui/Logo";
import { Alert, btnDanger, Card, Field, inputCls, tdCls, TextInput, thCls } from "@/ui/primitives";
import { formatDate, formatDateTime } from "@/domain/format";
import { formatBps, formatBRL } from "@/domain/money";
import { getDb } from "@/infra/db/client";
import { getItems, getQuoteByToken } from "@/modules/quotes/service";
import { toClientView } from "@/modules/quotes/views";
import { respondAction } from "./actions";

export const metadata: Metadata = { title: "Proposta comercial", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PropostaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const quote = await getQuoteByToken(db, token);
  if (!quote) notFound();
  const view = await toClientView(db, quote, await getItems(db, quote.id));

  const expired = quote.status === "expirado" || (quote.status === "enviado" && quote.validoAte.getTime() <= Date.now());
  const open = quote.status === "enviado" && !expired;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Logo className="h-12 w-auto" />
        <div className="text-right text-sm text-slate-600">
          <div className="font-semibold text-slate-900">Proposta {view.numero}</div>
          <div>Emitida em {formatDate(view.emitidoEm)} · válida até {formatDate(view.validoAte)}</div>
        </div>
      </header>

      {quote.status === "aprovado" && (
        <div className="mb-6"><Alert kind="ok"><strong>Proposta aprovada</strong>{quote.respondidoPorNome ? ` por ${quote.respondidoPorNome}` : ""}{quote.respondidoEm ? ` em ${formatDateTime(quote.respondidoEm)}` : ""}. Obrigado! Entraremos em contato para os próximos passos.</Alert></div>
      )}
      {quote.status === "recusado" && (
        <div className="mb-6"><Alert kind="warn"><strong>Proposta recusada</strong>{quote.respondidoPorNome ? ` por ${quote.respondidoPorNome}` : ""}{quote.respondidoEm ? ` em ${formatDateTime(quote.respondidoEm)}` : ""}.</Alert></div>
      )}
      {expired && (
        <div className="mb-6"><Alert kind="warn"><strong>Esta proposta expirou em {formatDate(view.validoAte)}.</strong> Os preços podem ter mudado: peça uma proposta atualizada ao seu vendedor.</Alert></div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card title="Para">
          <div className="text-sm text-slate-700">
            <div className="font-medium text-slate-900">{view.cliente.razaoSocial}</div>
            {view.cliente.cnpj && <div>CNPJ {view.cliente.cnpj}</div>}
            {view.cliente.contato && <div>A/C {view.cliente.contato}</div>}
          </div>
        </Card>
        <Card title="De">
          <div className="text-sm text-slate-700">
            <div className="font-medium text-slate-900">{view.empresa.nome}</div>
            {view.empresa.cnpj && <div>CNPJ {view.empresa.cnpj}</div>}
            {view.empresa.telefone && <div>{view.empresa.telefone}</div>}
            {view.empresa.email && <div>{view.empresa.email}</div>}
          </div>
        </Card>
      </div>

      <Card title="Itens" className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200">
              <tr><th className={thCls}>Item</th><th className={`${thCls} text-right`}>Qtd</th><th className={`${thCls} text-right`}>Unitário</th><th className={`${thCls} text-right`}>Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {view.itens.map((it, i) => (
                <tr key={i}>
                  <td className={tdCls}>
                    <div className="font-medium text-slate-900">{it.descricao}</div>
                    {it.detalhes && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-500">{it.detalhes}</p>}
                    {it.descontoBps > 0 && <div className="mt-1 text-xs text-slate-500">Desconto de {formatBps(it.descontoBps)}</div>}
                  </td>
                  <td className={`${tdCls} text-right`}>{it.quantidade}</td>
                  <td className={`${tdCls} whitespace-nowrap text-right`}>{formatBRL(it.precoUnitarioCentavos)}</td>
                  <td className={`${tdCls} whitespace-nowrap text-right font-medium`}>{formatBRL(it.totalCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(view.subtotalCentavos)}</dd></div>
          {view.descontoCentavos > 0 && <div className="flex justify-between"><dt>Descontos</dt><dd>-{formatBRL(view.descontoCentavos)}</dd></div>}
          {view.freteCentavos > 0 && <div className="flex justify-between"><dt>Frete</dt><dd>{formatBRL(view.freteCentavos)}</dd></div>}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold text-brand-700"><dt>Total</dt><dd>{formatBRL(view.totalCentavos)}</dd></div>
        </dl>
      </Card>

      <Card title="Condições" className="mb-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Pagamento</dt><dd>{view.condicoesPagamento || "—"}</dd></div>
          <div><dt className="text-slate-500">Prazo de entrega</dt><dd>{view.prazoEntrega || "—"}</dd></div>
          <div><dt className="text-slate-500">Garantia</dt><dd>{view.garantia || "—"}</dd></div>
        </dl>
        {view.observacoes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{view.observacoes}</p>}
      </Card>

      {open && (
        <Card title="Sua resposta" className="mb-6">
          <ActionForm
            action={respondAction}
            submitLabel="Aprovar proposta"
            className="space-y-4"
            secondary={<button type="submit" name="resultado" value="recusado" className={btnDanger}>Recusar</button>}
          >
            <input type="hidden" name="token" value={token} />
            <Field label="Seu nome" name="nome" hint="Fica registrado junto com a data e a hora da resposta.">
              <TextInput name="nome" required autoComplete="name" />
            </Field>
            <Field label="Motivo (obrigatório só se for recusar)" name="motivo">
              <textarea id="motivo" name="motivo" rows={2} className={inputCls} />
            </Field>
            <p className="text-xs text-slate-500">Ao aprovar, você confirma o pedido nos itens, valores e condições acima, válidos até {formatDate(view.validoAte)}.</p>
          </ActionForm>
        </Card>
      )}

      <div className="text-center">
        <a href={`/p/${token}/pdf`} className="text-sm text-brand-700 underline">Baixar em PDF</a>
      </div>
    </div>
  );
}
