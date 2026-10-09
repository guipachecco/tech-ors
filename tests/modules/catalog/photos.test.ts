import sharp from "sharp";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/modules/auth/sessions";
import { getProductPhoto, MAX_PHOTO_BYTES, PhotoError, removeProductPhoto, saveProductPhoto } from "@/modules/catalog/photos/service";
import { saveProduct } from "@/modules/catalog/products/service";
import { auditoria, produtoFotos, produtos, usuarios } from "@/infra/db/schema";
import { NotFoundError } from "@/infra/validation";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");

async function setup() {
  const db = await createTestDb();
  const u = await db.insert(usuarios).values({ nome: "A", email: "a@x.com", senhaHash: "h", perfil: "vendedor" }).returning().get();
  const user: SessionUser = { id: u.id, nome: "A", email: "a@x.com", perfil: "vendedor", podeVerCusto: false };
  const product = await saveProduct(db, user, { sku: "R260", fabricante: "Dell", modelo: "PowerEdge R260", categoria: "Servidor" });
  return { db, user, product };
}

const solid = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha } } });

describe("saveProductPhoto", () => {
  it("normalizes to JPEG, limits to 1000 px, never enlarges, and flattens transparency on white", async () => {
    const { db, user, product } = await setup();
    await saveProductPhoto(db, user, product.id, await solid(2400, 1200, 0).png().toBuffer(), NOW);
    const photo = (await getProductPhoto(db, product.id))!;
    const meta = await sharp(photo.data).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1000, height: 500 });
    const px = await sharp(photo.data).raw().toBuffer();
    expect([px[0], px[1], px[2]].every((v) => v >= 250)).toBe(true); // transparente → branco

    await saveProductPhoto(db, user, product.id, await solid(200, 100).jpeg().toBuffer(), NOW);
    expect(await sharp((await getProductPhoto(db, product.id))!.data).metadata()).toMatchObject({ width: 200, height: 100 });
  });

  it("applies EXIF orientation and strips metadata (GPS, camera)", async () => {
    const { db, user, product } = await setup();
    const rotated = await solid(300, 100).jpeg().withExif({ IFD0: { Copyright: "segredo-da-camera" } }).withMetadata({ orientation: 6 }).toBuffer();
    await saveProductPhoto(db, user, product.id, rotated, NOW);
    const stored = (await getProductPhoto(db, product.id))!.data;
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(stored.toString("latin1")).not.toContain("segredo-da-camera");
    expect(meta).toMatchObject({ width: 100, height: 300 }); // girada conforme a orientação
  });

  it("records the version on the product and audits the change", async () => {
    const { db, user, product } = await setup();
    expect((await db.select().from(produtos).where(eq(produtos.id, product.id)).get())!.fotoVersao).toBeNull();
    const res = await saveProductPhoto(db, user, product.id, await solid(50, 50).png().toBuffer(), NOW);
    expect(res.version).toBe(NOW.getTime());
    expect((await db.select().from(produtos).where(eq(produtos.id, product.id)).get())!.fotoVersao).toBe(NOW.getTime());
    expect((await db.select().from(auditoria).all()).some((a) => a.acao === "produto.foto_enviar")).toBe(true);
  });

  it("rejects files that are not real JPEG/PNG/WebP images, whatever their name", async () => {
    const { db, user, product } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>');
    const gif = await solid(10, 10).gif().toBuffer();
    for (const bad of [Buffer.from("isto não é uma imagem"), svg, gif, Buffer.alloc(0)]) {
      await expect(saveProductPhoto(db, user, product.id, bad, NOW)).rejects.toThrow(PhotoError);
    }
    expect(await db.select().from(produtoFotos).all()).toHaveLength(0);
  });

  it("rejects files above the size limit and images with an absurd number of pixels", async () => {
    const { db, user, product } = await setup();
    await expect(saveProductPhoto(db, user, product.id, Buffer.alloc(MAX_PHOTO_BYTES + 1), NOW)).rejects.toThrow(/MB/);
    const huge = await sharp({ create: { width: 7300, height: 7300, channels: 3, background: "#888" } }).png({ compressionLevel: 9 }).toBuffer();
    await expect(saveProductPhoto(db, user, product.id, huge, NOW)).rejects.toThrow(PhotoError);
  }, 60_000);

  it("fails for unknown products", async () => {
    const { db, user } = await setup();
    await expect(saveProductPhoto(db, user, 9999, await solid(10, 10).png().toBuffer(), NOW)).rejects.toThrow(NotFoundError);
  });
});

describe("removeProductPhoto", () => {
  it("removes the photo and clears the version", async () => {
    const { db, user, product } = await setup();
    await saveProductPhoto(db, user, product.id, await solid(50, 50).png().toBuffer(), NOW);
    await removeProductPhoto(db, user, product.id);
    expect(await getProductPhoto(db, product.id)).toBeNull();
    expect((await db.select().from(produtos).where(eq(produtos.id, product.id)).get())!.fotoVersao).toBeNull();
  });
});
