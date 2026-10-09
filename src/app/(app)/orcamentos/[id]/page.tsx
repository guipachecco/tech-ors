import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, AutoSaveForm, InlineAction } from "@/components/ActionForm";
import {
  Alert, Badge, btnDanger, btnPrimary, btnSecondary, Card, EmptyState, Field, inputCls, PageHeader, tdCls, TextInput, thCls,
} from "@/components/ui";
import { formatDate } from "@/domain/format";
import { formatBps, formatBRL } from "@/domain/money";
import { requireUser } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { searchProducts } from "@/server/catalog/products";
import { getClient } from "@/server/clients";
import { getDb } from "@/server/db/client";
import type { SendBlockReason } from "@/server/quotes/errors";
import { checkSendable, OVERRIDABLE, quoteTotals } from "@/server/quotes/guard";
import { getItems, getQuote, quoteDrift } from "@/server/quotes/service";
import { toItemViews } from "@/server/quotes/views";
import { NotFoundError } from "@/server/validation";
import {
  addItemAction, addServiceAction, duplicateAction, outcomeAction, removeItemAction, repriceItemAction,
  sendAction, setFreteAction, updateDetailsAction, updateItemAction,
} from "../actions";

const REASON_TEXT: Record<SendBlockReason, string> = {
  sem_itens: "Adicione pelo menos um item.",
  validade_vencida: "A validade da proposta já passou. Ajuste em “Condições”.",
  custo_vencido: "Há itens com custo vencido. Use “Atualizar preço” na linha do item.",
  margem_abaixo_minimo: "Há itens abaixo da margem mínima (desconto alto demais).",
};

const pctInput = (bps: number) => (bps / 100).toFixed(2).replace(".", ",");
const moneyInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const dateInput = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export default async function OrcamentoPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const { q = "" } = await searchParams;
  if (!Number.isInteger(id)) notFound();

  const db = getDb();
  let quote;
  try {
    quote = getQuote(db, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const now = new Date();
  const client = getClient(db, quote.clienteId);
  const rawItems = getItems(db, id);
  const items = toItemViews(rawItems, user, now);
  const totals = quoteTotals(quote, rawItems);
  const editable = quote.status === "em_elaboracao";
  const showCost = can(user, "cost:view");
  const check = checkSendable(quote, rawItems, now);
  const blockers = check.ok ? [] : check.motivos;
  const onlyOverridable = blockers.length > 0 && blockers.every((m) => OVERRIDABLE.includes(m));
  const canOverride = can(user, "quote:override");
  const results = editable && q ? searchProducts(db, user, q, 20, now) : [];
  const drift = editable && showCost ? quoteDrift(db, user, id, now) : [];

  return (
    <>
      <PageHeader
        title={`Orçamento ${quote.numero}`}
        subtitle={`${client.razaoSocial} · criado em ${formatDate(quote.criadoEm)} · válido até ${formatDate(quote.validoAte)}`}
        actions={
          <>
            <Badge kind={quote.status} />
            <a href={`/orcamentos/${id}/pdf`} className={btnPrimary}>Baixar PDF</a>
            <a href={`/orcamentos/${id}/xlsx`} className={btnSecondary}>Baixar XLSX</a>
            <InlineAction action={duplicateAction} label="Duplicar" className={btnSecondary}>
              <input type="hidden" name="orcamentoId" value={id} />
            </InlineAction>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {editable && (
            <Card title="Adicionar produtos">
              <form className="flex gap-2">
                <input name="q" defaultValue={q} placeholder="Buscar por SKU, modelo, fabricante, descrição… (Enter)" className={inputCls} autoFocus={!!q || items.length === 0} />
                <button className={btnSecondary}>Buscar</button>
              </form>
              {q && (
                <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                  {results.length === 0 && <div className="p-4 text-sm text-slate-500">Nenhum produto encontrado. <Link className="text-brand-700 underline" href="/produtos/novo">Cadastrar produto</Link></div>}
                  {results.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{p.fabricante} {p.modelo}</div>
                        <div className="text-xs text-slate-500">{p.sku} · {p.categoria}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        {p.precoVendaCentavos === null ? (
                          <Link href={`/produtos/${p.id}`} className="flex items-center gap-2 text-sm">
                            <Badge kind={p.statusCusto} /><span className="text-brand-700 underline">atualizar custo</span>
                          </Link>
                        ) : (
                          <>
                            <span className="text-sm font-semibold">{formatBRL(p.precoVendaCentavos)}</span>
                            <InlineAction action={addItemAction} label="Adicionar" className={btnPrimary}>
                              <input type="hidden" name="orcamentoId" value={id} />
                              <input type="hidden" name="produtoId" value={p.id} />
                              <input name="quantidade" type="number" min={1} defaultValue={1} className={`${inputCls} !w-20`} aria-label="Quantidade" />
                            </InlineAction>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card title={`Itens (${items.length})`}>
            {drift.length > 0 && (
              <div className="mb-4"><Alert kind="warn">
                O custo mudou no catálogo desde que estes itens foram adicionados:
                <ul className="mt-1 list-disc pl-5">
                  {drift.map((d) => <li key={d.itemId}>{d.descricao}: {formatBRL(d.custoCongeladoCentavos)} → {d.custoAtualCentavos === null ? "sem custo válido" : formatBRL(d.custoAtualCentavos)}</li>)}
                </ul>
                Use “Atualizar preço” para usar o custo atual.
              </Alert></div>
            )}
            {items.length === 0 ? <EmptyState>Busque um produto acima para começar.</EmptyState> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-slate-200"><tr>
                    <th className={thCls}>Descrição</th><th className={thCls}>Qtd</th><th className={thCls}>Unitário</th>
                    <th className={thCls}>Desc. %</th>{showCost && <th className={thCls}>Margem</th>}
                    <th className={`${thCls} text-right`}>Total</th><th className={thCls}></th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100 align-top">
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td className={tdCls}>
                          {it.descricao}
                          {it.custoVencido && <div className="mt-1"><Badge kind="vencido">Custo vencido</Badge></div>}
                          {it.abaixoDoMinimo && <div className="mt-1"><span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">Abaixo da margem mínima</span></div>}
                        </td>
                        {editable ? (
                          <td className={tdCls} colSpan={1}>
                            <AutoSaveForm action={updateItemAction} className="flex gap-2">
                              <input type="hidden" name="orcamentoId" value={id} />
                              <input type="hidden" name="itemId" value={it.id} />
                              <input name="quantidade" type="number" min={1} defaultValue={it.quantidade} className={`${inputCls} !w-20`} aria-label="Quantidade" />
                              <input name="desconto" defaultValue={pctInput(it.descontoBps)} className={`${inputCls} !w-24`} aria-label="Desconto (%)" inputMode="decimal" />
                            </AutoSaveForm>
                          </td>
                        ) : (
                          <td className={tdCls}>{it.quantidade}</td>
                        )}
                        <td className={tdCls}>{formatBRL(it.precoUnitarioCentavos)}</td>
                        <td className={tdCls}>{editable ? <span className="text-xs text-slate-400">← edite ao lado</span> : formatBps(it.descontoBps)}</td>
                        {showCost && <td className={tdCls}>{it.margemEfetivaBps === undefined ? "—" : it.margemEfetivaBps === null ? "—" : formatBps(it.margemEfetivaBps)}</td>}
                        <td className={`${tdCls} text-right font-medium`}>{formatBRL(it.totalCentavos)}</td>
                        <td className={`${tdCls} text-right`}>
                          {editable && (
                            <div className="flex justify-end gap-2">
                              {it.tipo === "produto" && it.custoVencido && (
                                <InlineAction action={repriceItemAction} label="Atualizar preço" className={btnSecondary}>
                                  <input type="hidden" name="orcamentoId" value={id} /><input type="hidden" name="itemId" value={it.id} />
                                </InlineAction>
                              )}
                              <InlineAction action={removeItemAction} label="Remover" className={btnDanger} confirm="Remover este item?">
                                <input type="hidden" name="orcamentoId" value={id} /><input type="hidden" name="itemId" value={it.id} />
                              </InlineAction>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {editable && (
            <Card title="Adicionar serviço ou licença avulsa">
              <ActionForm action={addServiceAction} submitLabel="Adicionar serviço" className="space-y-3">
                <input type="hidden" name="orcamentoId" value={id} />
                <div className="grid gap-3 sm:grid-cols-6">
                  <Field label="Descrição" name="descricao" className="sm:col-span-3"><TextInput name="descricao" placeholder="Ex.: Instalação e configuração" required /></Field>
                  <Field label="Qtd" name="quantidade"><TextInput name="quantidade" type="number" min={1} defaultValue={1} required /></Field>
                  <Field label="Valor unitário (R$)" name="preco" className="sm:col-span-2"><TextInput name="preco" inputMode="decimal" placeholder="0,00" required /></Field>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Totais">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(totals.subtotalCentavos)}</dd></div>
              {totals.descontoCentavos > 0 && <div className="flex justify-between"><dt>Descontos</dt><dd>-{formatBRL(totals.descontoCentavos)}</dd></div>}
              <div className="flex items-center justify-between gap-3">
                <dt>Frete</dt>
                <dd>
                  {editable ? (
                    <AutoSaveForm action={setFreteAction}>
                      <input type="hidden" name="orcamentoId" value={id} />
                      <input name="frete" defaultValue={quote.freteCentavos ? moneyInput(quote.freteCentavos) : ""} placeholder="0,00" inputMode="decimal" className={`${inputCls} !w-28 text-right`} aria-label="Frete" />
                    </AutoSaveForm>
                  ) : formatBRL(quote.freteCentavos)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold text-brand-700"><dt>Total</dt><dd>{formatBRL(totals.totalCentavos)}</dd></div>
            </dl>
          </Card>

          <Card title="Envio e resultado">
            {editable ? (
              <div className="space-y-3">
                {blockers.length > 0 && (
                  <Alert kind="warn"><ul className="list-disc pl-5">{blockers.map((m) => <li key={m}>{REASON_TEXT[m]}</li>)}</ul></Alert>
                )}
                {onlyOverridable && !canOverride && <Alert kind="info">Peça a um administrador para liberar o envio.</Alert>}
                <ActionForm action={sendAction} submitLabel="Marcar como enviado" className="space-y-3">
                  <input type="hidden" name="orcamentoId" value={id} />
                  {onlyOverridable && canOverride && (
                    <Field label="Justificativa para liberar o envio" name="justificativa" hint="Fica registrada na auditoria.">
                      <TextInput name="justificativa" required />
                    </Field>
                  )}
                </ActionForm>
                <p className="text-xs text-slate-500">Baixe o PDF/XLSX e envie ao cliente; depois marque como enviado para acompanhar o resultado.</p>
              </div>
            ) : quote.status === "enviado" ? (
              <div className="space-y-3">
                <InlineAction action={outcomeAction} label="Marcar como aprovado" className={btnPrimary}>
                  <input type="hidden" name="orcamentoId" value={id} /><input type="hidden" name="resultado" value="aprovado" />
                </InlineAction>
                <ActionForm action={outcomeAction} submitLabel="Marcar como recusado" className="space-y-2">
                  <input type="hidden" name="orcamentoId" value={id} /><input type="hidden" name="resultado" value="recusado" />
                  <Field label="Motivo da recusa" name="motivo"><TextInput name="motivo" required /></Field>
                </ActionForm>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Status: <Badge kind={quote.status} />{quote.motivoResultado ? ` — ${quote.motivoResultado}` : ""}</p>
            )}
          </Card>

          <Card title="Condições">
            {editable ? (
              <ActionForm action={updateDetailsAction} submitLabel="Salvar condições" className="space-y-3">
                <input type="hidden" name="orcamentoId" value={id} />
                <Field label="Válido até" name="validoAte"><TextInput name="validoAte" type="date" defaultValue={dateInput(quote.validoAte)} required /></Field>
                <Field label="Pagamento" name="condicoesPagamento"><TextInput name="condicoesPagamento" defaultValue={quote.condicoesPagamento} /></Field>
                <Field label="Prazo de entrega" name="prazoEntrega"><TextInput name="prazoEntrega" defaultValue={quote.prazoEntrega} /></Field>
                <Field label="Garantia" name="garantia"><TextInput name="garantia" defaultValue={quote.garantia} /></Field>
                <Field label="Observações" name="observacoes"><textarea id="observacoes" name="observacoes" rows={3} defaultValue={quote.observacoes} className={inputCls} /></Field>
              </ActionForm>
            ) : (
              <dl className="space-y-2 text-sm">
                <div><dt className="text-slate-500">Pagamento</dt><dd>{quote.condicoesPagamento || "—"}</dd></div>
                <div><dt className="text-slate-500">Prazo de entrega</dt><dd>{quote.prazoEntrega || "—"}</dd></div>
                <div><dt className="text-slate-500">Garantia</dt><dd>{quote.garantia || "—"}</dd></div>
                {quote.observacoes && <div><dt className="text-slate-500">Observações</dt><dd className="whitespace-pre-wrap">{quote.observacoes}</dd></div>}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
