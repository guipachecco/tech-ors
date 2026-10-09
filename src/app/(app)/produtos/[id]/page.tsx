import { notFound } from "next/navigation";
import { ActionForm, InlineAction } from "@/components/ActionForm";
import { ProductForm } from "@/components/ProductForm";
import { Alert, Badge, btnDanger, Card, Field, inputCls, PageHeader, tdCls, TextInput, thCls } from "@/components/ui";
import { defaultValidUntil } from "@/domain/costs";
import { formatDate } from "@/domain/format";
import { formatBps, formatBRL } from "@/domain/money";
import { requireUser } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";
import { resolveRule } from "@/server/catalog/margins";
import { listOffersForProduct } from "@/server/catalog/offers";
import { getProductRow, getProductView } from "@/server/catalog/products";
import { listSuppliers } from "@/server/catalog/suppliers";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/validation";
import { addOfferAction, removePhotoAction, uploadPhotoAction } from "../actions";

export default async function ProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  let row, view;
  try {
    row = getProductRow(db, id);
    view = getProductView(db, user, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const canWrite = can(user, "cost:write");
  const canView = can(user, "cost:view");
  const offers = canView ? listOffersForProduct(db, user, id) : [];
  const suppliers = listSuppliers(db);
  const rule = resolveRule(db, row);
  const defaultUntil = defaultValidUntil(new Date(), rule.validadeCustoDias).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  return (
    <>
      <PageHeader
        title={`${row.fabricante} ${row.modelo}`}
        subtitle={`SKU ${row.sku} · ${row.categoria}`}
        actions={<Badge kind={view.statusCusto} />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="Preço">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Preço de venda</dt><dd className="text-lg font-semibold">{view.precoVendaCentavos === null ? "—" : formatBRL(view.precoVendaCentavos)}</dd></div>
              {canView && (
                <>
                  <div><dt className="text-slate-500">Custo vigente</dt><dd className="text-lg font-semibold">{view.custo ? formatBRL(view.custo.custoCentavos) : "—"}</dd></div>
                  <div><dt className="text-slate-500">Margem aplicada</dt><dd>{view.margemBps !== undefined ? formatBps(view.margemBps) : "—"}</dd></div>
                  <div><dt className="text-slate-500">Margem mínima</dt><dd>{view.margemMinimaBps !== undefined ? formatBps(view.margemMinimaBps) : "—"}</dd></div>
                </>
              )}
            </dl>
            {view.statusCusto !== "valido" && (
              <div className="mt-4"><Alert kind="warn">
                {view.statusCusto === "vencido" ? "O custo deste produto venceu. Atualize o preço no fornecedor antes de orçar." : "Este produto ainda não tem custo cadastrado."}
              </Alert></div>
            )}
          </Card>
          <Card title="Foto do produto">
            <div className="flex flex-wrap items-start gap-5">
              <div className="flex h-40 w-52 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                {view.fotoVersao !== null ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/produtos/${id}/foto?v=${view.fotoVersao}`} alt={`Foto de ${row.fabricante} ${row.modelo}`} className="h-full w-full object-contain" />
                ) : (
                  <span className="px-4 text-center text-xs text-slate-400">Sem foto</span>
                )}
              </div>
              <div className="min-w-[14rem] flex-1 space-y-3">
                <ActionForm action={uploadPhotoAction} submitLabel={view.fotoVersao !== null ? "Trocar foto" : "Enviar foto"} className="space-y-3">
                  <input type="hidden" name="produtoId" value={id} />
                  <Field label="Foto (JPG, PNG ou WebP)" name="foto" hint="Até 8 MB. A imagem é ajustada (máx. 1000 px, fundo branco) e aparece no orçamento e no PDF.">
                    <input id="foto" name="foto" type="file" required accept="image/jpeg,image/png,image/webp" className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-[var(--btn)] file:px-3 file:py-1 file:text-sm file:font-medium file:text-[#fff]`} />
                  </Field>
                </ActionForm>
                {view.fotoVersao !== null && (
                  <InlineAction action={removePhotoAction} label="Remover foto" className={btnDanger} confirm="Remover a foto deste produto?">
                    <input type="hidden" name="produtoId" value={id} />
                  </InlineAction>
                )}
              </div>
            </div>
          </Card>
          <Card title="Dados do produto"><ProductForm product={row} /></Card>
        </div>

        <div className="space-y-6">
          {canWrite ? (
            <Card title="Atualizar custo">
              {suppliers.length === 0 ? (
                <Alert kind="info">Cadastre um fornecedor primeiro (menu Fornecedores).</Alert>
              ) : (
                <ActionForm action={addOfferAction} submitLabel="Salvar novo custo" className="space-y-4">
                  <input type="hidden" name="produtoId" value={id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Fornecedor" name="fornecedorId">
                      <select id="fornecedorId" name="fornecedorId" required className={inputCls}>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                      </select>
                    </Field>
                    <Field label="Custo (R$)" name="custo" hint="Ex.: 1.234,56"><TextInput name="custo" inputMode="decimal" required /></Field>
                    <Field label="Válido até" name="validoAte" hint={`Sugestão: ${rule.validadeCustoDias} dia(s)`}>
                      <TextInput name="validoAte" type="date" defaultValue={defaultUntil} />
                    </Field>
                    <Field label="SKU no fornecedor" name="skuFornecedor"><TextInput name="skuFornecedor" /></Field>
                  </div>
                  <Field label="Link da página do produto" name="urlProduto"><TextInput name="urlProduto" type="url" placeholder="https://…" /></Field>
                  <Field label="Observação" name="observacao" hint="Ex.: cotação em dólar a R$ 5,40"><TextInput name="observacao" /></Field>
                </ActionForm>
              )}
            </Card>
          ) : (
            <Card title="Custo"><p className="text-sm text-slate-500">Seu perfil não permite ver ou alterar custos.</p></Card>
          )}

          {canView && (
            <Card title="Histórico de custos">
              {offers.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum custo registrado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-slate-200"><tr><th className={thCls}>Data</th><th className={thCls}>Fornecedor</th><th className={thCls}>Custo</th><th className={thCls}>Válido até</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {offers.map((o) => (
                        <tr key={o.id}>
                          <td className={tdCls}>{formatDate(o.obtidoEm)}</td>
                          <td className={tdCls}>
                            {o.urlProduto ? <a href={o.urlProduto} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{o.fornecedorNome}</a> : o.fornecedorNome}
                            {o.observacao && <div className="text-xs text-slate-500">{o.observacao}</div>}
                          </td>
                          <td className={tdCls}>{formatBRL(o.custoCentavos)}</td>
                          <td className={tdCls}>{formatDate(o.validoAte)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
