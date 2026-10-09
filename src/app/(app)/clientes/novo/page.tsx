import { ClientForm } from "@/app/(app)/clientes/_components/ClientForm";
import { Card, PageHeader } from "@/ui/primitives";
import { requireUser } from "@/app/_shared/session";

export default async function NovoClientePage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Novo cliente" />
      <Card><ClientForm /></Card>
    </>
  );
}
