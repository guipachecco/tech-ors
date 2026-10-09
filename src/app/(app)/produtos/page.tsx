import Link from "next/link";
import { formatBRL } from "@/domain/money";
import { formatDate } from "@/domain/format";
import { Badge, btnPrimary, btnSecondary, Card, EmptyState, inputCls, PageHeader, tdCls, thCls } from "@/ui/primitives";
import { requireUser } from "@/app/_shared/session";
import { searchProducts } from "@/modules/catalog/products/service";
import { getDb } from "@/infra/db/client";

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const products = searchProducts(getDb(), user, q, 200);
  return (
    <>
      <PageHeader title="Produtos" subtitle="Catálogo com custo e validade" actions={<><Link href="/produtos/fotos" className={btnSecondary}>Fotos em lote</Link><Link href="/produtos/importar" className={btnSecondary}>Importar planilha</Link><Link href="/produtos/novo" className={btnPrimary}>Novo produto</Link></>} />
      <Card>
        <form className="mb-4 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Buscar por SKU, modelo, fabricante, descrição…" className={inputCls} autoFocus />
          <button className={btnSecondary}>Buscar</button>
        </form>
        {products.length === 0 ? (
          <EmptyState>{q ? "Nenhum produto encontrado." : "Nenhum produto cadastrado ainda."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className={thCls}>SKU</th><th className={thCls}>Produto</th><th className={thCls}>Categoria</th>
                  <th className={thCls}>Preço de venda</th><th className={thCls}>Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs`}>{p.sku}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-3">
                        {p.fotoVersao !== null && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/produtos/${p.id}/foto?v=${p.fotoVersao}`} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded border border-slate-200 bg-white object-contain" />
                        )}
                        <div className="min-w-0">
                          <Link href={`/produtos/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.fabricante} {p.modelo}</Link>
                          {p.descricao && <div className="max-w-md truncate text-xs text-slate-500">{p.descricao}</div>}
                        </div>
                      </div>
                    </td>
                    <td className={tdCls}>{p.categoria}</td>
                    <td className={tdCls}>{p.precoVendaCentavos === null ? "—" : formatBRL(p.precoVendaCentavos)}</td>
                    <td className={tdCls}>
                      <Badge kind={p.statusCusto} />
                      {p.custoObtidoEm && <div className="mt-0.5 text-xs text-slate-500">de {formatDate(p.custoObtidoEm)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
