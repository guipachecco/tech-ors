import { ClientForm } from "@/components/ClientForm";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/current";

export default async function NovoClientePage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Novo cliente" />
      <Card><ClientForm /></Card>
    </>
  );
}
