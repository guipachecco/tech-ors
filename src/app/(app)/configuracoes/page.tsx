import { ActionForm, InlineAction } from "@/ui/ActionForm";
import { btnDanger, Card, EmptyState, Field, inputCls, PageHeader, tdCls, TextInput, thCls } from "@/ui/primitives";
import { formatBps } from "@/domain/money";
import { requireCan } from "@/app/_shared/session";
import { listMarginRules } from "@/modules/catalog/margins/service";
import { getSettings } from "@/modules/catalog/settings/service";
import { getDb } from "@/infra/db/client";
import { deleteRuleAction, saveRuleAction, saveSettingsAction } from "./actions";

const pct = (bps: number) => (bps / 100).toFixed(2).replace(".", ",");

export default async function ConfiguracoesPage() {
  const user = await requireCan("settings:manage");
  const db = getDb();
  const s = await getSettings(db);
  const rules = await listMarginRules(db, user);
  return (
    <>
      <PageHeader title="Regras e configurações" subtitle="Margens, impostos, validade dos custos e dados da empresa" />
      <div className="space-y-6">
        <Card title="Regras de margem">
          <p className="mb-4 text-sm text-slate-600">
            A regra do <strong>fabricante</strong> vale antes da regra da <strong>categoria</strong>; sem regra, vale a margem padrão abaixo.
            A margem é calculada sobre o preço de venda. A validade (dias) pré-preenche o prazo do custo — use valores menores para SSD e memória.
          </p>
          {rules.length === 0 ? <EmptyState>Nenhuma regra cadastrada. Vale a margem padrão.</EmptyState> : (
            <table className="mb-6 w-full">
              <thead className="border-b border-slate-200"><tr>
                <th className={thCls}>Tipo</th><th className={thCls}>Nome</th><th className={thCls}>Margem</th>
                <th className={thCls}>Mínima</th><th className={thCls}>Validade do custo</th><th className={thCls}></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className={`${tdCls} capitalize`}>{r.escopo}</td>
                    <td className={tdCls}>{r.chave}</td>
                    <td className={tdCls}>{formatBps(r.margemBps)}</td>
                    <td className={tdCls}>{formatBps(r.margemMinimaBps)}</td>
                    <td className={tdCls}>{r.validadeCustoDias ? `${r.validadeCustoDias} dia(s)` : "padrão"}</td>
                    <td className={`${tdCls} text-right`}>
                      <InlineAction action={deleteRuleAction} label="Excluir" className={btnDanger} confirm="Excluir esta regra?">
                        <input type="hidden" name="id" value={r.id} />
                      </InlineAction>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Adicionar ou alterar regra</h3>
          <ActionForm action={saveRuleAction} submitLabel="Salvar regra" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-5">
              <Field label="Tipo" name="escopo">
                <select id="escopo" name="escopo" className={inputCls}><option value="categoria">Categoria</option><option value="fabricante">Fabricante</option></select>
              </Field>
              <Field label="Nome" name="chave" hint="Igual ao cadastro do produto"><TextInput name="chave" required /></Field>
              <Field label="Margem (%)" name="margem"><TextInput name="margem" inputMode="decimal" placeholder="20" required /></Field>
              <Field label="Mínima (%)" name="margemMinima"><TextInput name="margemMinima" inputMode="decimal" placeholder="10" required /></Field>
              <Field label="Validade do custo (dias)" name="validadeCustoDias"><TextInput name="validadeCustoDias" inputMode="numeric" placeholder="padrão" /></Field>
            </div>
          </ActionForm>
        </Card>

        <Card title="Configurações gerais">
          <ActionForm action={saveSettingsAction} submitLabel="Salvar configurações" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Margem padrão (%)" name="margemPadrao"><TextInput name="margemPadrao" defaultValue={pct(s.margemPadraoBps)} required /></Field>
              <Field label="Margem mínima padrão (%)" name="margemMinimaPadrao"><TextInput name="margemMinimaPadrao" defaultValue={pct(s.margemMinimaPadraoBps)} required /></Field>
              <Field label="Impostos embutidos no preço (%)" name="impostos" hint="Percentual sobre o preço de venda"><TextInput name="impostos" defaultValue={pct(s.impostosBps)} required /></Field>
              <Field label="Validade padrão do custo (dias)" name="validadeCustoDiasPadrao"><TextInput name="validadeCustoDiasPadrao" type="number" min={1} defaultValue={s.validadeCustoDiasPadrao} required /></Field>
              <Field label="Validade da proposta (dias)" name="validadePropostaDias"><TextInput name="validadePropostaDias" type="number" min={1} defaultValue={s.validadePropostaDias} required /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da empresa" name="empresaNome"><TextInput name="empresaNome" defaultValue={s.empresaNome} required /></Field>
              <Field label="CNPJ da empresa" name="empresaCnpj"><TextInput name="empresaCnpj" defaultValue={s.empresaCnpj} /></Field>
              <Field label="Endereço" name="empresaEndereco"><TextInput name="empresaEndereco" defaultValue={s.empresaEndereco} /></Field>
              <Field label="Telefone" name="empresaTelefone"><TextInput name="empresaTelefone" defaultValue={s.empresaTelefone} /></Field>
              <Field label="E-mail" name="empresaEmail"><TextInput name="empresaEmail" defaultValue={s.empresaEmail} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Condições de pagamento (padrão)" name="condicoesPagamento"><TextInput name="condicoesPagamento" defaultValue={s.condicoesPagamento} /></Field>
              <Field label="Prazo de entrega (padrão)" name="prazoEntrega"><TextInput name="prazoEntrega" defaultValue={s.prazoEntrega} /></Field>
              <Field label="Garantia (padrão)" name="garantia"><TextInput name="garantia" defaultValue={s.garantia} /></Field>
            </div>
            <Field label="Observações padrão" name="observacoesPadrao">
              <textarea id="observacoesPadrao" name="observacoesPadrao" rows={3} defaultValue={s.observacoesPadrao} className={inputCls} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
