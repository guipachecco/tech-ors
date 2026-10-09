import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/current";

export default async function AcessoNegadoPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Acesso negado" />
      <Card className="max-w-xl">
        <p className="text-sm text-slate-700">Seu perfil não tem permissão para esta área. Peça a um administrador, se precisar de acesso.</p>
        <Link href="/orcamentos" className="mt-4 inline-block text-sm text-brand-700 underline">Voltar aos orçamentos</Link>
      </Card>
    </>
  );
}
