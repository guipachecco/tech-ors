import Link from "next/link";
import { ActionForm } from "@/ui/ActionForm";
import { Alert, Card, Field, inputCls, PageHeader } from "@/ui/primitives";
import { requireUser } from "@/app/_shared/session";
import { searchClients } from "@/modules/clients/service";
import { getDb } from "@/infra/db/client";
import { createQuoteAction } from "../actions";

export default async function NovoOrcamentoPage() {
  await requireUser();
  const clients = await searchClients(getDb(), "", 1000);
  return (
    <>
      <PageHeader title="Novo orçamento" subtitle="Escolha o cliente para começar" />
      <Card className="max-w-xl">
        {clients.length === 0 ? (
          <Alert kind="info">Cadastre um cliente primeiro. <Link href="/clientes/novo" className="font-medium underline">Novo cliente</Link></Alert>
        ) : (
          <ActionForm action={createQuoteAction} submitLabel="Criar orçamento" className="space-y-4"
            secondary={<Link href="/clientes/novo" className="text-sm text-brand-700 hover:underline">Cadastrar novo cliente</Link>}>
            <Field label="Cliente" name="clienteId">
              <select id="clienteId" name="clienteId" required className={inputCls} autoFocus>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
              </select>
            </Field>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
