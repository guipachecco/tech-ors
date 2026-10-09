import { Card, PageHeader } from "@/ui/primitives";
import { ProductForm } from "@/app/(app)/produtos/_components/ProductForm";
import { requireUser } from "@/app/_shared/session";

export default async function NovoProdutoPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Novo produto" subtitle="Depois de salvar, cadastre o custo do fornecedor." />
      <Card><ProductForm /></Card>
    </>
  );
}
