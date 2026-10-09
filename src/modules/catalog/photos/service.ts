import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { recordAudit } from "@/infra/audit";
import type { SessionUser } from "@/modules/auth/sessions";
import type { Db } from "@/infra/db/client";
import { produtoFotos, produtos } from "@/infra/db/schema";
import { NotFoundError } from "@/infra/validation";

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // a Vercel recusa requisições acima de ~4,5 MB
const MAX_PIXELS = 50_000_000; // protege a memória contra imagens "bomba"
const MAX_SIDE = 1000;
const ALLOWED = new Set(["jpeg", "png", "webp"]); // SVG, GIF e afins ficam de fora

/** Erro com mensagem para o usuário (arquivo inválido, grande demais etc.). */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

/**
 * Confere o tipo REAL da imagem (pelo conteúdo, não pelo nome) e devolve uma versão nova:
 * JPEG de até 1000 px, fundo branco, sem metadados (EXIF/GPS). Regravar também descarta
 * qualquer conteúdo escondido no arquivo original.
 */
export async function normalizePhoto(input: Buffer): Promise<Buffer> {
  if (input.length === 0) throw new PhotoError("O arquivo está vazio.");
  if (input.length > MAX_PHOTO_BYTES) throw new PhotoError(`A foto passa de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
    if (!meta.format || !ALLOWED.has(meta.format)) throw new PhotoError("Use uma foto JPG, PNG ou WebP.");
    return await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate() // aplica a orientação do EXIF e descarta o resto
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();
  } catch (e) {
    if (e instanceof PhotoError) throw e;
    throw new PhotoError("Não consegui ler essa imagem. Envie uma foto JPG, PNG ou WebP (até 4 MB e 50 megapixels).");
  }
}

/** Grava (ou troca) a foto já tratada de um produto. */
export async function storeProductPhoto(db: Db, productId: number, jpeg: Buffer, now: Date): Promise<void> {
  await db.insert(produtoFotos)
    .values({ produtoId: productId, dados: jpeg, atualizadoEm: now })
    .onConflictDoUpdate({ target: produtoFotos.produtoId, set: { dados: jpeg, atualizadoEm: now } })
    .run();
  await db.update(produtos).set({ fotoVersao: now.getTime() }).where(eq(produtos.id, productId)).run();
}

export async function saveProductPhoto(db: Db, user: SessionUser, productId: number, input: Buffer, now = new Date()): Promise<{ version: number; bytes: number }> {
  const product = await db.select({ id: produtos.id }).from(produtos).where(eq(produtos.id, productId)).get();
  if (!product) throw new NotFoundError("Produto");
  const jpeg = await normalizePhoto(input);
  await db.transaction(async (tx) => await storeProductPhoto(tx as unknown as Db, productId, jpeg, now));
  await recordAudit(db, { userId: user.id, acao: "produto.foto_enviar", entidade: "produto", entidadeId: productId, depois: { bytes: jpeg.length } });
  return { version: now.getTime(), bytes: jpeg.length };
}

export async function removeProductPhoto(db: Db, user: SessionUser, productId: number): Promise<void> {
  const product = await db.select({ id: produtos.id }).from(produtos).where(eq(produtos.id, productId)).get();
  if (!product) throw new NotFoundError("Produto");
  await db.transaction(async (tx) => {
    await tx.delete(produtoFotos).where(eq(produtoFotos.produtoId, productId)).run();
    await tx.update(produtos).set({ fotoVersao: null }).where(eq(produtos.id, productId)).run();
  });
  await recordAudit(db, { userId: user.id, acao: "produto.foto_remover", entidade: "produto", entidadeId: productId });
}

export async function getProductPhoto(db: Db, productId: number): Promise<{ data: Buffer; version: number } | null> {
  const row = await db.select().from(produtoFotos).where(eq(produtoFotos.produtoId, productId)).get();
  return row ? { data: row.dados, version: row.atualizadoEm.getTime() } : null;
}

/** Fotos de vários produtos numa consulta só (produto → imagem JPEG). */
export async function getProductPhotos(db: Db, productIds: number[]): Promise<Map<number, Buffer>> {
  const out = new Map<number, Buffer>();
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await db.select().from(produtoFotos).where(inArray(produtoFotos.produtoId, ids.slice(i, i + 50))).all();
    for (const r of rows) out.set(r.produtoId, r.dados);
  }
  return out;
}
