import { eq } from "drizzle-orm";
import sharp from "sharp";
import { recordAudit } from "../audit";
import type { SessionUser } from "../auth/sessions";
import type { Db } from "../db/client";
import { produtoFotos, produtos } from "../db/schema";
import { NotFoundError } from "../validation";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
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
 * Recebe a foto enviada, confere o tipo REAL da imagem (pelo conteúdo, não pelo nome),
 * e grava uma versão nova: JPEG de até 1000 px, fundo branco, sem metadados (EXIF/GPS).
 * Regravar também descarta qualquer conteúdo escondido no arquivo original.
 */
export async function saveProductPhoto(db: Db, user: SessionUser, productId: number, input: Buffer, now = new Date()): Promise<{ version: number; bytes: number }> {
  if (input.length === 0) throw new PhotoError("O arquivo está vazio.");
  if (input.length > MAX_PHOTO_BYTES) throw new PhotoError(`A foto passa de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
  const product = db.select({ id: produtos.id }).from(produtos).where(eq(produtos.id, productId)).get();
  if (!product) throw new NotFoundError("Produto");

  let jpeg: Buffer;
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
    if (!meta.format || !ALLOWED.has(meta.format)) throw new PhotoError("Use uma foto JPG, PNG ou WebP.");
    jpeg = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate() // aplica a orientação do EXIF e descarta o resto
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();
  } catch (e) {
    if (e instanceof PhotoError) throw e;
    throw new PhotoError("Não consegui ler essa imagem. Envie uma foto JPG, PNG ou WebP (até 8 MB e 50 megapixels).");
  }

  const version = now.getTime();
  db.transaction((tx) => {
    tx.insert(produtoFotos).values({ produtoId: productId, dados: jpeg, atualizadoEm: now })
      .onConflictDoUpdate({ target: produtoFotos.produtoId, set: { dados: jpeg, atualizadoEm: now } }).run();
    tx.update(produtos).set({ fotoVersao: version }).where(eq(produtos.id, productId)).run();
  });
  recordAudit(db, { userId: user.id, acao: "produto.foto_enviar", entidade: "produto", entidadeId: productId, depois: { bytes: jpeg.length } });
  return { version, bytes: jpeg.length };
}

export function removeProductPhoto(db: Db, user: SessionUser, productId: number): void {
  const product = db.select({ id: produtos.id }).from(produtos).where(eq(produtos.id, productId)).get();
  if (!product) throw new NotFoundError("Produto");
  db.transaction((tx) => {
    tx.delete(produtoFotos).where(eq(produtoFotos.produtoId, productId)).run();
    tx.update(produtos).set({ fotoVersao: null }).where(eq(produtos.id, productId)).run();
  });
  recordAudit(db, { userId: user.id, acao: "produto.foto_remover", entidade: "produto", entidadeId: productId });
}

export function getProductPhoto(db: Db, productId: number): { data: Buffer; version: number } | null {
  const row = db.select().from(produtoFotos).where(eq(produtoFotos.produtoId, productId)).get();
  return row ? { data: row.dados, version: row.atualizadoEm.getTime() } : null;
}
