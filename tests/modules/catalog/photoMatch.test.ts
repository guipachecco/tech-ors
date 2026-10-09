import sharp from "sharp";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/modules/auth/sessions";
import { addCostOffer } from "@/modules/catalog/costs/service";
import { getProductPhoto, PhotoError, saveProductPhoto } from "@/modules/catalog/photos/service";
import { applyPhotoByName, matchPhotoName, MAX_FAMILY_MATCHES } from "@/modules/catalog/photos/match";
import { saveProduct } from "@/modules/catalog/products/service";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import { produtos, usuarios } from "@/infra/db/schema";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const img = (color = "#336699") => sharp({ create: { width: 120, height: 80, channels: 3, background: color } }).png().toBuffer();

async function setup() {
  const db = await createTestDb();
  const u = await db.insert(usuarios).values({ nome: "A", email: "a@x.com", senhaHash: "h", perfil: "administrador" }).returning().get();
  const user: SessionUser = { id: u.id, nome: "A", email: "a@x.com", perfil: "administrador", podeVerCusto: true };
  const supplier = await saveSupplier(db, user, { nome: "Dell" });
  const mk = async (sku: string, modelo: string, extra = {}) =>
    await saveProduct(db, user, { sku, fabricante: "Dell", modelo, categoria: "Servidor", ...extra });
  const r260 = await mk("pe_r260_18399_bcc_1", "PowerEdge R260 (rack 1U)");
  const t160a = await mk("pe_t160_18389_bcc_3", "PowerEdge T160 (Xeon 6315P)");
  const t160b = await mk("pe_t160_18389_bcc_4", "PowerEdge T160 (Xeon 6325P)");
  const r360 = await mk("pe_r360_18250", "PowerEdge R360");
  await addCostOffer(db, user, { produtoId: r360.id, fornecedorId: supplier.id, skuFornecedor: "DELL-R360-XYZ", custoCentavos: 100000 }, NOW);
  return { db, user, r260, t160a, t160b, r360 };
}

describe("matchPhotoName", () => {
  it("matches the internal SKU exactly, ignoring case, extension and separators", async () => {
    const { db, r260 } = await setup();
    for (const name of ["pe_r260_18399_bcc_1.jpg", "PE-R260-18399-BCC-1.PNG", "pe r260 18399 bcc 1.webp", "pe_r260_18399_bcc_1 (1).jpg"]) {
      const m = await matchPhotoName(db, name);
      expect(m.via).toBe("sku");
      expect(m.produtos.map((p) => p.id)).toEqual([r260.id]);
    }
  });

  it("matches the supplier's own code", async () => {
    const { db, r360 } = await setup();
    const m = await matchPhotoName(db, "dell-r360-xyz.jpg");
    expect(m.via).toBe("codigo");
    expect(m.produtos.map((p) => p.id)).toEqual([r360.id]);
  });

  it("matches by model name and covers every variation of that model", async () => {
    const { db, t160a, t160b } = await setup();
    const m = await matchPhotoName(db, "poweredge-t160.jpg");
    expect(m.via).toBe("nome");
    expect(m.produtos.map((p) => p.id).sort()).toEqual([t160a.id, t160b.id].sort());
    // mais específico → só uma variação
    expect((await matchPhotoName(db, "t160 6325p.jpg")).produtos.map((p) => p.id)).toEqual([t160b.id]);
  });

  it("an exact SKU wins over a broader name match", async () => {
    const { db, r260 } = await setup();
    await saveProduct(db, { id: 1 } as SessionUser, { sku: "r260", fabricante: "Outro", modelo: "R260 Acessório", categoria: "Cabo" });
    await saveProduct(db, { id: 1 } as SessionUser, { sku: "r260-kit", fabricante: "Outro", modelo: "R260 Kit", categoria: "Cabo" });
    const m = await matchPhotoName(db, "r260.jpg");
    expect(m.via).toBe("sku");
    expect(m.produtos).toHaveLength(1);
    expect(m.produtos[0].id).not.toBe(r260.id);
  });

  it("reports names that match nothing, are too short, or are too broad", async () => {
    const { db, user } = await setup();
    expect(await matchPhotoName(db, "nao-existe-xyz.jpg")).toMatchObject({ via: "nenhum", produtos: [] });
    expect((await matchPhotoName(db, "a.jpg")).via).toBe("nenhum"); // curto demais
    for (let i = 0; i < MAX_FAMILY_MATCHES + 1; i++) {
      await saveProduct(db, user, { sku: `kit-${i}`, fabricante: "Genérico", modelo: `Cabo ${i}`, categoria: "Cabo" });
    }
    const wide = await matchPhotoName(db, "cabo.jpg");
    expect(wide.via).toBe("amplo");
    expect(wide.total).toBeGreaterThan(MAX_FAMILY_MATCHES);
    expect(wide.produtos).toEqual([]);
  });

  it("flags which matched products already have a photo", async () => {
    const { db, user, t160a } = await setup();
    await saveProductPhoto(db, user, t160a.id, await img(), NOW);
    const m = await matchPhotoName(db, "t160.jpg");
    expect(m.produtos.find((p) => p.id === t160a.id)!.temFoto).toBe(true);
    expect(m.produtos.filter((p) => !p.temFoto)).toHaveLength(1);
  });
});

describe("applyPhotoByName", () => {
  it("applies the same photo to all matched products and audits once", async () => {
    const { db, user, t160a, t160b } = await setup();
    const r = await applyPhotoByName(db, user, "poweredge-t160.png", await img(), { replace: false }, NOW);
    expect(r).toMatchObject({ encontrados: 2, salvos: 2, ignorados: 0 });
    expect(await getProductPhoto(db, t160a.id)).not.toBeNull();
    expect(await getProductPhoto(db, t160b.id)).not.toBeNull();
    expect((await db.select().from(produtos).where(eq(produtos.id, t160a.id)).get())!.fotoVersao).toBe(NOW.getTime());
  });

  it("keeps existing photos unless replacement is requested", async () => {
    const { db, user, t160a, t160b } = await setup();
    await saveProductPhoto(db, user, t160a.id, await img("#ff0000"), NOW);
    const before = (await getProductPhoto(db, t160a.id))!.data;
    const r1 = await applyPhotoByName(db, user, "t160.jpg", await img("#00ff00"), { replace: false }, NOW);
    expect(r1).toMatchObject({ encontrados: 2, salvos: 1, ignorados: 1 });
    expect((await getProductPhoto(db, t160a.id))!.data.equals(before)).toBe(true);
    expect(await getProductPhoto(db, t160b.id)).not.toBeNull();

    const r2 = await applyPhotoByName(db, user, "t160.jpg", await img("#00ff00"), { replace: true }, NOW);
    expect(r2).toMatchObject({ encontrados: 2, salvos: 2, ignorados: 0 });
    expect((await getProductPhoto(db, t160a.id))!.data.equals(before)).toBe(false);
  });

  it("rejects names with no match, names that are too broad, and invalid images, saving nothing", async () => {
    const { db, user } = await setup();
    await expect(applyPhotoByName(db, user, "nada-a-ver.jpg", await img(), { replace: false }, NOW)).rejects.toThrow(/Nenhum produto/);
    await expect(applyPhotoByName(db, user, "poweredge.jpg", Buffer.from("não é imagem"), { replace: false }, NOW)).rejects.toThrow(PhotoError);
    expect((await db.select().from(produtos).all()).every((p) => p.fotoVersao === null)).toBe(true);
  });
});
