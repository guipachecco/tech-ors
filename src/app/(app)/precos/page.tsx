import Link from "next/link";
import { headers } from "next/headers";
import { ActionForm, InlineAction } from "@/ui/ActionForm";
import { Alert, Badge, btnDanger, btnSecondary, Card, EmptyState, Field, inputCls, PageHeader, tdCls, TextInput, thCls } from "@/ui/primitives";
import { formatBRL } from "@/domain/money";
import { formatDateTime } from "@/domain/format";
import { requireCan } from "@/app/_shared/session";
import { getDb } from "@/infra/db/client";
import { can } from "@/modules/auth/permissions";
import { listPendingChanges, listRuns, listSources, parseRunSummary, type PriceSource } from "@/modules/catalog/autoprice";
import { listSuppliers } from "@/modules/catalog/suppliers/service";
import { generateTokenAction, resolvePendingAction, revokeTokenAction, runNowAction, saveSourceAction, uploadAndUpdateAction } from "./actions";
import { SelectAll } from "./SelectAll";

const DAY = 86_400_000;
/** Sem atualização com sucesso há mais que isso, o fornecedor aparece em alerta (os custos estão vencendo). */
const STALE_DAYS = 2;

function sourceState(s: PriceSource | undefined, now: number): { kind: string; label: string } {
  if (!s || (!s.urlArquivo && !s.tokenHash)) return { kind: "em_elaboracao", label: "Só manual" };
  if (!s.ativo) return { kind: "em_elaboracao", label: "Pausado" };
  if (!s.ultimoSucessoEm) return { kind: "expirado", label: "Aguardando 1ª atualização" };
  const days = Math.floor((now - s.ultimoSucessoEm.getTime()) / DAY);
  if (days >= STALE_DAYS) return { kind: "vencido", label: `Sem atualizar há ${days} dias` };
  if (s.ultimaExecucaoEm && s.ultimaExecucaoEm.getTime() > s.ultimoSucessoEm.getTime()) return { kind: "expirado", label: "Última tentativa falhou" };
  return { kind: "aprovado", label: "Em dia" };
}

const RUN_BADGE = { ok: ["aprovado", "OK"], revisar: ["expirado", "Revisar"], erro: ["vencido", "Erro"] } as const;
const ORIGIN = { agendado: "Agendado", envio: "Recebido", manual: "Manual" } as const;

export default async function PrecosPage({ searchParams }: { searchParams: Promise<{ fornecedor?: string }> }) {
  const user = await requireCan("cost:write");
  const admin = can(user, "settings:manage");
  const { fornecedor } = await searchParams;
  const db = getDb();
  const [suppliers, sources, pending, runs] = await Promise.all([listSuppliers(db), listSources(db), listPendingChanges(db, user), listRuns(db, user)]);
  const sourceBySupplier = new Map(sources.map((s) => [s.fornecedorId, s]));
  const selected = fornecedor ? suppliers.find((s) => s.id === Number(fornecedor)) : undefined;
  const selectedSource = selected ? sourceBySupplier.get(selected.id) : undefined;
  const now = Date.now();

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "seu-site";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");

  return (
    <>
      <PageHeader title="Preços automáticos" subtitle="Os fornecedores mandam (ou o sistema busca) a planilha e o catálogo se atualiza sozinho" />

      {pending.length > 0 && (
        <Card title={`Aguardando sua aprovação (${pending.length})`} className="mb-6 border-amber-300">
          <p className="mb-3 text-sm text-slate-600">
            Estes preços mudaram além do limite de segurança e <strong>ainda não entraram</strong> no catálogo (pode ser promoção, erro do fornecedor ou da planilha). Confira antes de aprovar.
          </p>
          <ActionForm
            action={resolvePendingAction}
            submitLabel="Aprovar selecionadas"
            secondary={<button type="submit" name="decisao" value="descartar" className={btnDanger}>Descartar selecionadas</button>}
          >
            <div className="mb-2"><SelectAll name="ids" /></div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className={thCls}></th><th className={thCls}>Produto</th><th className={thCls}>Fornecedor</th>
                    <th className={`${thCls} text-right`}>Custo atual</th><th className={`${thCls} text-right`}>Custo novo</th><th className={`${thCls} text-right`}>Variação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pending.map((p) => {
                    const pct = ((p.novoCentavos - p.anteriorCentavos) / p.anteriorCentavos) * 100;
                    return (
                      <tr key={p.id}>
                        <td className={tdCls}><input type="checkbox" name="ids" value={p.id} aria-label={`Selecionar ${p.produtoNome}`} /></td>
                        <td className={tdCls}><Link href={`/produtos/${p.produtoId}`} className="text-brand-700 hover:underline">{p.produtoNome}</Link></td>
                        <td className={tdCls}>{p.fornecedorNome}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>{formatBRL(p.anteriorCentavos)}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>{formatBRL(p.novoCentavos)}</td>
                        <td className={`${tdCls} text-right tabular-nums ${pct > 0 ? "text-red-700" : "text-green-700"}`}>{pct > 0 ? "+" : ""}{pct.toFixed(1).replace(".", ",")}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </Card>
      )}

      <Card title="Fornecedores" className="mb-6">
        {suppliers.length === 0 ? <EmptyState>Cadastre os fornecedores primeiro.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200">
                <tr><th className={thCls}>Fornecedor</th><th className={thCls}>Como recebe</th><th className={thCls}>Última atualização</th><th className={thCls}>Situação</th><th className={thCls}></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => {
                  const src = sourceBySupplier.get(s.id);
                  const st = sourceState(src, now);
                  const channels = [src?.urlArquivo ? "Link (todo dia)" : null, src?.tokenHash ? `Envio (chave …${src.tokenFinal})` : null].filter(Boolean).join(" + ");
                  return (
                    <tr key={s.id} className={selected?.id === s.id ? "bg-brand-50" : undefined}>
                      <td className={tdCls}>{s.nome}</td>
                      <td className={tdCls}>{channels || "—"}</td>
                      <td className={tdCls}>{src?.ultimoSucessoEm ? formatDateTime(src.ultimoSucessoEm) : "—"}</td>
                      <td className={tdCls}><Badge kind={st.kind}>{st.label}</Badge></td>
                      <td className={`${tdCls} text-right`}>
                        <span className="inline-flex items-center gap-3">
                          {src?.urlArquivo && (
                            <InlineAction action={runNowAction} label="Atualizar agora" className="text-brand-700 hover:underline">
                              <input type="hidden" name="fornecedorId" value={s.id} />
                            </InlineAction>
                          )}
                          <Link href={`/precos?fornecedor=${s.id}`} className="text-brand-700 hover:underline">{admin ? "Configurar" : "Enviar planilha"}</Link>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card title={`Enviar planilha agora: ${selected.nome}`}>
            <p className="mb-3 text-sm text-slate-600">
              Atualiza o catálogo direto, usando as colunas já salvas para este fornecedor. Preço igual só renova a validade; mudanças muito grandes esperam a sua aprovação.
              Para cadastrar produtos novos ou escolher as colunas, use <Link href="/produtos/importar" className="text-brand-700 hover:underline">Importar planilha</Link>.
            </p>
            <ActionForm action={uploadAndUpdateAction} submitLabel="Enviar e atualizar" className="space-y-4">
              <input type="hidden" name="fornecedorId" value={selected.id} />
              <Field label="Planilha (.xlsx ou .csv)" name="arquivo">
                <input id="arquivo" name="arquivo" type="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={inputCls} />
              </Field>
            </ActionForm>
          </Card>

          {admin && (
            <Card title="Receber sozinho">
              <ActionForm
                action={saveSourceAction}
                submitLabel="Salvar"
                className="space-y-4"
                key={`${selected.id}-${selectedSource?.urlArquivo ?? ""}-${selectedSource?.limiteVariacaoBps ?? ""}`}
              >
                <input type="hidden" name="fornecedorId" value={selected.id} />
                <Field label="Link da planilha (opcional)" name="urlArquivo" hint="O sistema baixa este link todo dia. Aceita link de compartilhamento do Google Planilhas, Google Drive e Dropbox, ou um link direto https://…">
                  <TextInput name="urlArquivo" type="url" placeholder="https://…" defaultValue={selectedSource?.urlArquivo ?? ""} />
                </Field>
                <Field
                  label="Login do link (opcional)"
                  name="cabecalhoAuth"
                  hint={selectedSource?.cabecalhoAuth ? "Já há um login salvo (criptografado). Preencha só para trocar." : "Se o link exigir, no formato Nome: valor (ex.: Authorization: Bearer abc123)."}
                >
                  <TextInput name="cabecalhoAuth" type="password" autoComplete="off" placeholder={selectedSource?.cabecalhoAuth ? "••••••••" : "Authorization: Bearer …"} />
                </Field>
                <Field label="Variação máxima automática (%)" name="limite" hint="Mudança de custo acima disso não entra sozinha: espera a sua aprovação.">
                  <TextInput name="limite" required defaultValue={String((selectedSource?.limiteVariacaoBps ?? 3000) / 100).replace(".", ",")} inputMode="decimal" />
                </Field>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="ativo" defaultChecked={selectedSource?.ativo ?? true} /> Atualização automática ligada
                </label>
              </ActionForm>
            </Card>
          )}

          {admin && (
            <Card title="Receber por envio (e-mail, automação ou script)" className="lg:col-span-2">
              <p className="mb-3 text-sm text-slate-600">
                Quando o fornecedor manda a planilha por e-mail, uma automação (Zapier, Make, Power Automate ou Google Apps Script) encaminha o anexo para o endereço abaixo,
                com a chave. O catálogo se atualiza no mesmo instante. Passo a passo em <code>docs/precos-automaticos.md</code>.
              </p>
              <pre className="mb-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{`curl -X POST "${proto}://${host}/api/precos/${selected.id}" \\
  -H "Authorization: Bearer SUA_CHAVE" \\
  -H "X-Filename: lista.xlsx" \\
  --data-binary @lista.xlsx`}</pre>
              <div className="flex flex-wrap items-start gap-3">
                <ActionForm
                  action={generateTokenAction}
                  submitLabel={selectedSource?.tokenHash ? "Gerar nova chave (a atual deixa de valer)" : "Gerar chave"}
                  className="max-w-xl"
                >
                  <input type="hidden" name="fornecedorId" value={selected.id} />
                  <p className="text-sm text-slate-600">{selectedSource?.tokenHash ? `Chave atual termina em …${selectedSource.tokenFinal}.` : "Ainda não há chave."}</p>
                </ActionForm>
                {selectedSource?.tokenHash && (
                  <InlineAction action={revokeTokenAction} label="Desativar chave" className={btnSecondary} confirm="Desativar a chave? Quem usa ela para enviar planilhas deixará de funcionar.">
                    <input type="hidden" name="fornecedorId" value={selected.id} />
                  </InlineAction>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      <Card title="Histórico de atualizações">
        {runs.length === 0 ? <EmptyState>Nenhuma atualização ainda.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200">
                <tr><th className={thCls}>Quando</th><th className={thCls}>Fornecedor</th><th className={thCls}>Origem</th><th className={thCls}>Resultado</th><th className={thCls}>Detalhes</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => {
                  const sum = parseRunSummary(r);
                  const [kind, label] = RUN_BADGE[r.status];
                  return (
                    <tr key={r.id} className="align-top">
                      <td className={`${tdCls} whitespace-nowrap`}>{formatDateTime(r.iniciadaEm)}</td>
                      <td className={tdCls}>{r.fornecedorNome}</td>
                      <td className={tdCls}>{ORIGIN[r.origem]}</td>
                      <td className={tdCls}><Badge kind={kind}>{label}</Badge></td>
                      <td className={tdCls}>
                        {r.mensagem}
                        {sum && sum.codigosNaoCadastrados.length > 0 && (
                          <div className="mt-1 text-xs text-slate-500">
                            Não cadastrados: {sum.codigosNaoCadastrados.join(", ")}{sum.naoCadastrados > sum.codigosNaoCadastrados.length ? "…" : ""} — use{" "}
                            <Link href="/produtos/importar" className="text-brand-700 hover:underline">Importar planilha</Link> para cadastrá-los.
                          </div>
                        )}
                        {sum && sum.amostraErros.length > 0 && (
                          <div className="mt-1 text-xs text-slate-500">Ex.: linha {sum.amostraErros[0].linha}: {sum.amostraErros[0].motivo}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {!admin && <div className="mt-4"><Alert kind="info">A configuração dos canais automáticos é feita por um administrador.</Alert></div>}
    </>
  );
}
