import { notFound } from "next/navigation";
import { ClientForm } from "@/app/(app)/clientes/_components/ClientForm";
import { InlineAction } from "@/ui/ActionForm";
import { Card, btnPrimary, PageHeader } from "@/ui/primitives";
import { requireUser } from "@/app/_shared/session";
import { getClient } from "@/modules/clients/service";
import { getDb } from "@/infra/db/client";
import { NotFoundError } from "@/infra/validation";
import { createQuoteAction } from "../../orcamentos/actions";

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  let client;
  try {
    client = getClient(getDb(), id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        title={client.razaoSocial}
        actions={
          <InlineAction action={createQuoteAction} label="Novo orçamento para este cliente" className={btnPrimary}>
            <input type="hidden" name="clienteId" value={client.id} />
          </InlineAction>
        }
      />
      <Card><ClientForm client={client} /></Card>
    </>
  );
}
