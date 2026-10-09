import { Card, PageHeader } from "@/components/ui";
import { ProductForm } from "@/components/ProductForm";
import { requireUser } from "@/server/auth/current";

export default async function NovoProdutoPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Novo produto" subtitle="Depois de salvar, cadastre o custo do fornecedor." />
      <Card><ProductForm /></Card>
    </>
  );
}
