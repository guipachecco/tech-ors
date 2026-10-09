import { ActionForm, InlineAction } from "@/ui/ActionForm";
import { Alert, Badge, btnSecondary, Card, Field, inputCls, PageHeader, tdCls, TextInput, thCls } from "@/ui/primitives";
import { formatDate } from "@/domain/format";
import { requireCan } from "@/app/_shared/session";
import { can } from "@/modules/auth/permissions";
import { getDb } from "@/infra/db/client";
import { listUsers } from "@/modules/users/service";
import { createUserAction, resetMfaAction, resetPasswordAction, toggleAccessAction } from "./actions";

const PROFILE_LABEL = { root: "Root", administrador: "Administrador", vendedor: "Vendedor" } as const;

export default async function UsuariosPage() {
  const viewer = await requireCan("user:manage");
  const users = listUsers(getDb(), viewer);
  const canCreateAdmin = can(viewer, "admin:manage");
  return (
    <>
      <PageHeader title="Usuários" subtitle="Quem acessa o sistema e quem pode ver custos" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Novo usuário" className="lg:col-span-1">
          <ActionForm action={createUserAction} submitLabel="Criar usuário" className="space-y-4">
            <Field label="Nome" name="nome"><TextInput name="nome" required /></Field>
            <Field label="E-mail" name="email"><TextInput name="email" type="email" required /></Field>
            <Field label="Senha inicial" name="senha" hint="Mínimo de 10 caracteres"><TextInput name="senha" type="password" autoComplete="new-password" required /></Field>
            <Field label="Perfil" name="perfil" hint={canCreateAdmin ? undefined : "Só o Root cria administradores."}>
              <select id="perfil" name="perfil" className={inputCls}>
                <option value="vendedor">Vendedor</option>
                {canCreateAdmin && <option value="administrador">Administrador</option>}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="podeVerCusto" /> Pode ver custos e margens (vendedor)</label>
          </ActionForm>
        </Card>
        <Card className="lg:col-span-2">
          <table className="w-full">
            <thead className="border-b border-slate-200"><tr><th className={thCls}>Usuário</th><th className={thCls}>Perfil</th><th className={thCls}>Acesso</th><th className={thCls}>Desde</th></tr></thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {users.map((u) => {
                const protectedRoot = u.perfil === "root" && viewer.perfil !== "root"; // só o próprio Root mexe no Root
                const isSelf = u.id === viewer.id;
                return (
                  <tr key={u.id}>
                    <td className={tdCls}><div className="font-medium">{u.nome}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                    <td className={tdCls}>
                      {u.perfil === "root" ? <Badge kind="enviado">Root</Badge> : PROFILE_LABEL[u.perfil]}
                      {u.podeVerCusto && u.perfil === "vendedor" ? " (vê custo)" : ""}
                    </td>
                    <td className={tdCls}>
                      <div className="flex flex-col items-start gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge kind={u.ativo ? "valido" : "vencido"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>
                          <Badge kind={u.totpAtivo ? "valido" : "expirado"}>{u.totpAtivo ? "2FA ativo" : "2FA pendente"}</Badge>
                        </div>
                        {protectedRoot ? (
                          <p className="max-w-xs text-xs text-slate-500">Conta do dono do sistema: só o Root pode alterá-la.</p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-2">
                              {u.perfil !== "root" && !isSelf && (
                                <InlineAction action={toggleAccessAction} label={u.ativo ? "Desativar" : "Ativar"} className={btnSecondary}>
                                  <input type="hidden" name="id" value={u.id} /><input type="hidden" name="campo" value="ativo" /><input type="hidden" name="valor" value={u.ativo ? "0" : "1"} />
                                </InlineAction>
                              )}
                              {u.perfil === "vendedor" && (
                                <InlineAction action={toggleAccessAction} label={u.podeVerCusto ? "Ocultar custos" : "Mostrar custos"} className={btnSecondary}>
                                  <input type="hidden" name="id" value={u.id} /><input type="hidden" name="campo" value="podeVerCusto" /><input type="hidden" name="valor" value={u.podeVerCusto ? "0" : "1"} />
                                </InlineAction>
                              )}
                            </div>
                            {u.totpAtivo && (
                              <InlineAction action={resetMfaAction} label="Redefinir 2FA" className={btnSecondary} confirm="Redefinir o 2FA deste usuário? Ele sairá de todas as sessões e configurará um novo autenticador no próximo login.">
                                <input type="hidden" name="id" value={u.id} />
                              </InlineAction>
                            )}
                            <InlineAction action={resetPasswordAction} label="Redefinir senha" className={btnSecondary}>
                              <input type="hidden" name="id" value={u.id} />
                              <input name="senha" type="password" placeholder="Nova senha" autoComplete="new-password" className={inputCls} required />
                            </InlineAction>
                          </>
                        )}
                      </div>
                    </td>
                    <td className={tdCls}>{formatDate(u.criadoEm)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!canCreateAdmin && <div className="mt-4"><Alert kind="info">Criar ou alterar administradores é função do Root.</Alert></div>}
        </Card>
      </div>
    </>
  );
}
