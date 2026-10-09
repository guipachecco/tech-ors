import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/ui/ActionForm";
import { Alert, Badge, btnPrimary, btnSecondary, Card, EmptyState, Field, inputCls, PageHeader, tdCls, TextInput, thCls } from "@/ui/primitives";
import { FIELD_LABELS, FIELDS } from "@/domain/import";
import { formatBRL } from "@/domain/money";
import { requireCan } from "@/app/_shared/session";
import { analyzeImport, getImportRecord, importResult, type RowStatus } from "@/modules/catalog/import";
import { getDb } from "@/infra/db/client";
import { NotFoundError } from "@/infra/validation";
import { applyImportAction, saveMappingAction } from "../actions";

const STATUS: Record<RowStatus, { label: string; kind: string; hint: string }> = {
  novo: { label: "Novo", kind: "valido", hint: "Produto será cadastrado" },
  atualiza: { label: "Atualiza", kind: "enviado", hint: "Novo custo no histórico" },
  reconfirma: { label: "Reconfirma", kind: "em_elaboracao", hint: "Mesmo custo, renova a validade" },
  erro: { label: "Erro", kind: "vencido", hint: "Não será importado" },
};

export default async function ImportacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCan("cost:write");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();

  let record;
  try {
    record = getImportRecord(db, user, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  // Importação concluída: mostra o resultado.
  const done = importResult(record);
  if (record.aplicadaEm && done) {
    return (
      <>
        <PageHeader title="Importação concluída" subtitle={record.nomeArquivo} />
        <Card className="max-w-xl">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-slate-500">Produtos novos</dt><dd className="text-2xl font-semibold">{done.novos}</dd></div>
            <div><dt className="text-slate-500">Custos atualizados</dt><dd className="text-2xl font-semibold">{done.atualizados}</dd></div>
            <div><dt className="text-slate-500">Custos reconfirmados</dt><dd className="text-2xl font-semibold">{done.reconfirmados}</dd></div>
            <div><dt className="text-slate-500">Linhas ignoradas</dt><dd className="text-2xl font-semibold">{done.ignorados}</dd></div>
          </dl>
          <div className="mt-6 flex gap-2">
            <Link href="/produtos" className={btnPrimary}>Ver produtos</Link>
            <Link href="/produtos/importar" className={btnSecondary}>Importar outra planilha</Link>
          </div>
        </Card>
      </>
    );
  }

  const a = analyzeImport(db, user, id);
  const selectable = a.rows.filter((r) => r.status !== "erro");
  const select = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <>
      <PageHeader title={`Importar de ${a.fornecedorNome}`} subtitle={`${record.nomeArquivo} · ${JSON.parse(record.linhasJson).length} linhas`} actions={<Link href="/produtos/importar" className={btnSecondary}>Cancelar</Link>} />

      <Card title="2. Confira as colunas" className="mb-6">
        <p className="mb-4 text-sm text-slate-600">
          Para cada campo, escolha a coluna da planilha. Só <strong>código</strong> e <strong>custo</strong> são obrigatórios. A escolha fica salva para este fornecedor.
        </p>
        <ActionForm action={saveMappingAction} submitLabel="Atualizar pré-visualização" className="space-y-4">
          <input type="hidden" name="importId" value={id} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELDS.map((f) => (
              <Field key={f} label={`${FIELD_LABELS[f]}${f === "codigo" || f === "custo" ? " *" : ""}`} name={`map_${f}`}>
                <select id={`map_${f}`} name={`map_${f}`} defaultValue={a.mapping[f] ?? ""} className={select}>
                  <option value="">— não usar —</option>
                  {a.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria padrão (para produtos novos sem categoria)" name="padrao_categoria"><TextInput name="padrao_categoria" defaultValue={a.defaults.categoria ?? ""} placeholder="Ex.: Switch" /></Field>
            <Field label="Fabricante padrão (para produtos novos sem fabricante)" name="padrao_fabricante"><TextInput name="padrao_fabricante" defaultValue={a.defaults.fabricante ?? ""} placeholder="Ex.: Genérico" /></Field>
          </div>
        </ActionForm>

        <details className="mt-5">
          <summary className="cursor-pointer text-sm text-brand-700">Ver as primeiras linhas da planilha</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>{a.headers.map((h) => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {a.sample.map((r, i) => <tr key={i}>{a.headers.map((h, c) => <td key={h} className="px-3 py-1.5 text-slate-600">{String(r[c] ?? "")}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card title="3. Confira e importe">
        {a.missingRequired.length > 0 ? (
          <Alert kind="warn">Escolha as colunas obrigatórias acima ({a.missingRequired.map((f) => FIELD_LABELS[f]).join(" e ")}) e clique em “Atualizar pré-visualização”.</Alert>
        ) : a.rows.length === 0 ? (
          <EmptyState>Nenhuma linha encontrada.</EmptyState>
        ) : (
          <ActionForm action={applyImportAction} submitLabel={`Importar ${selectable.length} linha(s) marcada(s)`} className="space-y-4">
            <input type="hidden" name="importId" value={id} />
            <div className="flex flex-wrap gap-2 text-sm">
              {(Object.keys(STATUS) as RowStatus[]).map((s) => (
                <span key={s} className="flex items-center gap-1.5"><Badge kind={STATUS[s].kind}>{STATUS[s].label}</Badge> {a.summary[s]}</span>
              ))}
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-md border border-slate-200">
              <table className="w-full">
                <thead className="sticky top-0 border-b border-slate-200 bg-white">
                  <tr><th className={thCls}></th><th className={thCls}>Linha</th><th className={thCls}>Código</th><th className={thCls}>Produto</th><th className={thCls}>Custo</th><th className={thCls}>Situação</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {a.rows.map((r) => (
                    <tr key={r.rowNumber} className={r.status === "erro" ? "opacity-70" : undefined}>
                      <td className={tdCls}>
                        {r.status !== "erro" && <input type="checkbox" name="linhas" value={r.rowNumber} defaultChecked aria-label={`Importar linha ${r.rowNumber}`} />}
                      </td>
                      <td className={`${tdCls} text-slate-500`}>{r.rowNumber}</td>
                      <td className={`${tdCls} font-mono text-xs`}>{r.parsed.codigo || "—"}</td>
                      <td className={tdCls}>
                        {r.produtoNome ?? r.parsed.descricao ?? "—"}
                        {r.parsed.descricao && r.produtoNome && r.parsed.descricao !== r.produtoNome && <div className="max-w-md truncate text-xs text-slate-500">{r.parsed.descricao}</div>}
                      </td>
                      <td className={tdCls}>
                        {r.parsed.custoCentavos ? formatBRL(r.parsed.custoCentavos) : "—"}
                        {r.custoAnteriorCentavos !== undefined && r.status !== "erro" && <div className="text-xs text-slate-500">antes {formatBRL(r.custoAnteriorCentavos)}</div>}
                      </td>
                      <td className={tdCls}>
                        <Badge kind={STATUS[r.status].kind}>{STATUS[r.status].label}</Badge>
                        {r.problemas.map((p) => <div key={p} className="mt-1 text-xs text-red-700">{p}</div>)}
                        {r.parsed.warnings.map((w) => <div key={w} className="mt-1 text-xs text-amber-900">{w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">Desmarque as linhas que não quer importar. Linhas com erro nunca são importadas. Tudo é gravado de uma vez: se algo falhar, nada é alterado.</p>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
