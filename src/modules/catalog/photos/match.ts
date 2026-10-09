import { eq } from "drizzle-orm";
import { normalizeSearch } from "@/domain/search";
import { recordAudit } from "@/infra/audit";
import type { SessionUser } from "@/modules/auth/sessions";
import type { Db } from "@/infra/db/client";
import { ofertasCusto, produtos } from "@/infra/db/schema";
import { normalizePhoto, PhotoError, storeProductPhoto } from "./service";

/** Um nome de arquivo que corresponda a mais produtos que isso é "amplo demais" (ex.: "dell.jpg"). */
export const MAX_FAMILY_MATCHES = 100;

export type MatchVia = "sku" | "codigo" | "nome" | "amplo" | "nenhum";

export type PhotoMatch = {
  nome: string;
  via: MatchVia;
  /** Quantos produtos corresponderam (mesmo quando "amplo", em que a lista vem vazia). */
  total: number;
  produtos: Array<{ id: number; rotulo: string; temFoto: boolean }>;
};

/** "PE-R260 (1).JPG" → "pe r260": sem extensão, sem sufixo de cópia, sem pontuação, minúsculo e sem acento. */
export function photoKey(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/\s*\(\d+\)\s*$/, "");
  return normalizeSearch(base);
}

type Row = { id: number; sku: string; fabricante: string; modelo: string; busca: string; fotoVersao: number | null };
const label = (p: Row) => `${p.fabricante} ${p.modelo} (${p.sku})`;
const pack = (rows: Row[]) =>
  rows.map((p) => ({ id: p.id, rotulo: label(p), temFoto: p.fotoVersao !== null })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));

type Indexed = Row & { words: Set<string> };
type Index = { rows: Indexed[]; skuToRows: Map<string, Indexed[]>; codeToProducts: Map<string, Set<number>> };

/** Lê o catálogo uma vez (centenas de produtos) para casar muitos arquivos de uma vez. */
function loadIndex(db: Db): Index {
  const rows: Indexed[] = db
    .select({ id: produtos.id, sku: produtos.sku, fabricante: produtos.fabricante, modelo: produtos.modelo, busca: produtos.busca, fotoVersao: produtos.fotoVersao })
    .from(produtos)
    .where(eq(produtos.ativo, true))
    .all()
    .map((p) => ({ ...p, words: new Set(p.busca.split(" ")) }));
  const skuToRows = new Map<string, Indexed[]>();
  for (const p of rows) {
    const k = normalizeSearch(p.sku);
    skuToRows.set(k, [...(skuToRows.get(k) ?? []), p]);
  }
  const codeToProducts = new Map<string, Set<number>>();
  for (const o of db.select({ produtoId: ofertasCusto.produtoId, cod: ofertasCusto.skuFornecedor }).from(ofertasCusto).all()) {
    if (!o.cod) continue;
    const k = normalizeSearch(o.cod);
    if (!codeToProducts.has(k)) codeToProducts.set(k, new Set());
    codeToProducts.get(k)!.add(o.produtoId);
  }
  return { rows, skuToRows, codeToProducts };
}

function matchWith(index: Index, fileName: string): PhotoMatch {
  const key = photoKey(fileName);
  const none: PhotoMatch = { nome: fileName, via: "nenhum", total: 0, produtos: [] };
  if (key.replace(/ /g, "").length < 3) return none;

  const bySku = index.skuToRows.get(key) ?? [];
  if (bySku.length > 0) return { nome: fileName, via: "sku", total: bySku.length, produtos: pack(bySku) };

  const codeIds = index.codeToProducts.get(key);
  const byCode = codeIds ? index.rows.filter((p) => codeIds.has(p.id)) : [];
  if (byCode.length > 0) return { nome: fileName, via: "codigo", total: byCode.length, produtos: pack(byCode) };

  const words = key.split(" ");
  const byName = index.rows.filter((p) => words.every((w) => p.words.has(w)));
  if (byName.length === 0) return none;
  if (byName.length > MAX_FAMILY_MATCHES) return { nome: fileName, via: "amplo", total: byName.length, produtos: [] };
  return { nome: fileName, via: "nome", total: byName.length, produtos: pack(byName) };
}

/**
 * Descobre a quais produtos a foto pertence, pelo nome do arquivo. Em ordem de prioridade:
 * 1) SKU interno igual; 2) código do fornecedor igual; 3) todas as palavras do nome aparecem no produto
 * (o nome do modelo vale para todas as variações dele). Para no primeiro critério que achar algo.
 */
export function matchPhotoName(db: Db, fileName: string): PhotoMatch {
  return matchWith(loadIndex(db), fileName);
}

export function matchPhotoNames(db: Db, fileNames: string[]): PhotoMatch[] {
  const index = loadIndex(db);
  return fileNames.map((n) => matchWith(index, n));
}

export type PhotoBatchResult = { encontrados: number; salvos: number; ignorados: number };

/** Aplica UMA foto a todos os produtos que o nome do arquivo identifica. A imagem é tratada uma vez só. */
export async function applyPhotoByName(
  db: Db, user: SessionUser, fileName: string, input: Buffer, opts: { replace: boolean }, now = new Date(),
): Promise<PhotoBatchResult> {
  const match = matchPhotoName(db, fileName);
  if (match.via === "nenhum") throw new PhotoError("Nenhum produto corresponde a este nome de arquivo.");
  if (match.via === "amplo") throw new PhotoError(`O nome corresponde a ${match.total} produtos (limite ${MAX_FAMILY_MATCHES}). Use o código ou um nome mais específico.`);

  const jpeg = await normalizePhoto(input); // valida e trata antes de gravar qualquer coisa
  const targets = match.produtos.filter((p) => opts.replace || !p.temFoto);
  db.transaction((tx) => {
    for (const p of targets) storeProductPhoto(tx as unknown as Db, p.id, jpeg, now);
  });
  if (targets.length > 0) {
    recordAudit(db, { userId: user.id, acao: "produto.foto_lote", entidade: "produto", depois: { arquivo: fileName.slice(0, 120), via: match.via, produtos: targets.length } });
  }
  return { encontrados: match.total, salvos: targets.length, ignorados: match.total - targets.length };
}
