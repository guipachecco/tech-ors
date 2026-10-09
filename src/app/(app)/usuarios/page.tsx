import { ActionForm, InlineAction } from "@/components/ActionForm";
import { Badge, btnSecondary, Card, Field, inputCls, PageHeader, tdCls, TextInput, thCls } from "@/components/ui";
import { formatDate } from "@/domain/format";
import { requireCan } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { listUsers } from "@/server/users";
import { createUserAction, resetPasswordAction, toggleAccessAction } from "./actions";

export default async function UsuariosPage() {
  const admin = await requireCan("user:manage");
  const users = listUsers(getDb(), admin);
  return (
    <>
      <PageHeader title="Usuários" subtitle="Quem acessa o sistema e quem pode ver custos" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Novo usuário" className="lg:col-span-1">
          <ActionForm action={createUserAction} submitLabel="Criar usuário" className="space-y-4">
            <Field label="Nome" name="nome"><TextInput name="nome" required /></Field>
            <Field label="E-mail" name="email"><TextInput name="email" type="email" required /></Field>
            <Field label="Senha inicial" name="senha" hint="Mínimo de 10 caracteres"><TextInput name="senha" type="password" autoComplete="new-password" required /></Field>
            <Field label="Perfil" name="perfil">
              <select id="perfil" name="perfil" className={inputCls}><option value="vendedor">Vendedor</option><option value="administrador">Administrador</option></select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="podeVerCusto" /> Pode ver custos e margens (vendedor)</label>
          </ActionForm>
        </Card>
        <Card className="lg:col-span-2">
          <table className="w-full">
            <thead className="border-b border-slate-200"><tr><th className={thCls}>Usuário</th><th className={thCls}>Perfil</th><th className={thCls}>Acesso</th><th className={thCls}>Desde</th></tr></thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className={tdCls}><div className="font-medium">{u.nome}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                  <td className={`${tdCls} capitalize`}>{u.perfil}{u.podeVerCusto && u.perfil === "vendedor" ? " (vê custo)" : ""}</td>
                  <td className={tdCls}>
                    <div className="flex flex-col items-start gap-2">
                      <Badge kind={u.ativo ? "valido" : "vencido"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>
                      <div className="flex flex-wrap gap-2">
                        <InlineAction action={toggleAccessAction} label={u.ativo ? "Desativar" : "Ativar"} className={btnSecondary}>
                          <input type="hidden" name="id" value={u.id} /><input type="hidden" name="campo" value="ativo" /><input type="hidden" name="valor" value={u.ativo ? "0" : "1"} />
                        </InlineAction>
                        {u.perfil === "vendedor" && (
                          <InlineAction action={toggleAccessAction} label={u.podeVerCusto ? "Ocultar custos" : "Mostrar custos"} className={btnSecondary}>
                            <input type="hidden" name="id" value={u.id} /><input type="hidden" name="campo" value="podeVerCusto" /><input type="hidden" name="valor" value={u.podeVerCusto ? "0" : "1"} />
                          </InlineAction>
                        )}
                      </div>
                      <InlineAction action={resetPasswordAction} label="Redefinir senha" className={btnSecondary}>
                        <input type="hidden" name="id" value={u.id} />
                        <input name="senha" type="password" placeholder="Nova senha" autoComplete="new-password" className={inputCls} required />
                      </InlineAction>
                    </div>
                  </td>
                  <td className={tdCls}>{formatDate(u.criadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
