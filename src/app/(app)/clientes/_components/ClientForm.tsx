import { saveClientAction } from "@/app/(app)/clientes/actions";
import { formatCnpj } from "@/domain/cnpj";
import type { Client } from "@/modules/clients/service";
import { ActionForm } from "@/ui/ActionForm";
import { Field, TextInput } from "@/ui/primitives";

export function ClientForm({ client }: { client?: Client }) {
  return (
    <ActionForm action={saveClientAction} submitLabel={client ? "Salvar alterações" : "Cadastrar cliente"} className="space-y-4">
      {client && <input type="hidden" name="id" value={client.id} />}
      <Field label="Razão social" name="razaoSocial"><TextInput name="razaoSocial" defaultValue={client?.razaoSocial} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CNPJ" name="cnpj"><TextInput name="cnpj" defaultValue={client?.cnpj ? formatCnpj(client.cnpj) : ""} /></Field>
        <Field label="Contato" name="contato"><TextInput name="contato" defaultValue={client?.contato ?? ""} /></Field>
        <Field label="E-mail" name="email"><TextInput name="email" type="email" defaultValue={client?.email ?? ""} /></Field>
        <Field label="Telefone" name="telefone"><TextInput name="telefone" defaultValue={client?.telefone ?? ""} /></Field>
      </div>
    </ActionForm>
  );
}
