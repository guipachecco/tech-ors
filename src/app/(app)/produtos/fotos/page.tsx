import Link from "next/link";
import { Card, PageHeader, btnSecondary } from "@/components/ui";
import { requireUser } from "@/server/auth/current";
import { BulkPhotos } from "./BulkPhotos";

export default async function FotosEmLotePage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Fotos em lote"
        subtitle="Envie muitas fotos de uma vez: o nome do arquivo diz de qual produto é"
        actions={<Link href="/produtos" className={btnSecondary}>Voltar aos produtos</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Como nomear os arquivos" className="lg:order-2">
          <ul className="space-y-3 text-sm text-slate-600">
            <li><strong className="text-slate-800">Pelo SKU ou pelo código do fornecedor</strong><br /><code className="text-xs">pe_r260_18399_bcc_1.jpg</code> → só esse produto.</li>
            <li><strong className="text-slate-800">Pelo nome do modelo</strong><br /><code className="text-xs">poweredge-t160.jpg</code> → todas as variações do T160 (uma foto só para todas).</li>
            <li><strong className="text-slate-800">Mais específico</strong><br /><code className="text-xs">t160 6325p.jpg</code> → só as que têm “t160” e “6325p”.</li>
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Maiúsculas, acentos e símbolos (<code>_ - .</code>) não importam. Nomes que servem para mais de 100 produtos (como “dell.jpg”) são recusados.
            JPG, PNG ou WebP, até 8 MB cada. Você confere a lista antes de enviar.
          </p>
        </Card>
        <Card className="lg:order-1 lg:col-span-2">
          <BulkPhotos />
        </Card>
      </div>
    </>
  );
}
