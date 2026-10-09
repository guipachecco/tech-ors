import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { listOffersForProduct } from "@/modules/catalog/costs/service";
import { createProducts, getProductView, saveProduct, searchProducts } from "@/modules/catalog/products/service";
import { addCostOffer } from "@/modules/catalog/costs/service";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import {
  analyzeImport, applyImport, assertSafeXlsx, createImport, ImportError, MAX_ROWS, readSheet, saveImportMapping,
} from "@/modules/catalog/import";
import { auditoria, ofertasCusto, produtos, usuarios } from "@/infra/db/schema";
import { NotFoundError, ValidationError } from "@/infra/validation";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;

async function xlsx(rows: unknown[][], opts: { sheetName?: string } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName ?? "Preços");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function setup() {
  const db = await createTestDb();
  const mk = async (nome: string, perfil: "administrador" | "vendedor", podeVerCusto: boolean): Promise<SessionUser> => {
    const u = await db.insert(usuarios).values({ nome, email: `${nome}@x.com`, senhaHash: "h", perfil, podeVerCusto }).returning().get();
    return { id: u.id, nome, email: u.email, perfil, podeVerCusto };
  };
  const admin = await mk("adm", "administrador", true);
  const seller = await mk("ven", "vendedor", false);
  const buyer = await mk("comp", "vendedor", true); // vendedor com permissão de custo
  const supplier = await saveSupplier(db, admin, { nome: "Distribuidora Alfa" });
  return { db, admin, seller, buyer, supplier };
}

const HEADER = ["Código", "Descrição", "Marca", "Categoria", "Preço Unitário (R$)", "Link"];

describe("readSheet", () => {
  it("skips title rows, finds the header, reads formulas, rich text and links as values", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Lista");
    ws.addRow(["LISTA DE PREÇOS OUTUBRO"]);
    ws.addRow([]);
    ws.addRow(HEADER);
    ws.addRow(["A1", { richText: [{ text: "SSD " }, { text: "1TB" }] }, "Kingston", "SSD", { formula: "100+20.5", result: 120.5 }, { text: "ver", hyperlink: "https://x.com/a1" }]);
    ws.addRow([]);
    ws.addRow(["A2", "Memória", "Kingston", "Memória", 99, null]);
    const sheet = await readSheet(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(sheet.headers).toEqual(HEADER);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toEqual(["A1", "SSD 1TB", "Kingston", "SSD", 120.5, "ver"]);
    expect(sheet.rows[1][4]).toBe(99);
  });

  it("names empty and duplicate headers", async () => {
    const sheet = await readSheet(await xlsx([["Código", "Preço", "Preço", null], ["A", 1, 2, 3]]));
    expect(sheet.headers).toEqual(["Código", "Preço", "Preço (2)", "Coluna 4"]);
  });

  it("rejects non-xlsx files, empty sheets and too many rows", async () => {
    await expect(readSheet(Buffer.from("isto não é uma planilha"))).rejects.toThrow(ImportError);
    await expect(readSheet(Buffer.alloc(0))).rejects.toThrow(ImportError);
    await expect(readSheet(await xlsx([["a", "b"]]))).rejects.toThrow(/nenhuma linha/);
    const big = [HEADER, ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`C${i}`, "x", "y", "z", 1, null])];
    await expect(readSheet(await xlsx(big))).rejects.toThrow(/máximo/);
  }, 60_000);

  it("refuses a zip that claims to expand to an absurd size (zip bomb)", async () => {
    const buf = await xlsx([HEADER, ["A", "x", "y", "z", 1, null]]);
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buf.writeUInt32LE(0xffffffff, cd + 24); // tamanho descompactado declarado
    expect(() => assertSafeXlsx(buf)).toThrow(/grande demais/);
    await expect(readSheet(buf)).rejects.toThrow(ImportError);
  });
});

describe("createImport and mapping", () => {
  it("requires permission to change costs and an existing supplier", async () => {
    const { db, seller, admin, supplier } = await setup();
    const buffer = await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]);
    await expect(createImport(db, seller, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer }, NOW)).rejects.toThrow(ForbiddenError);
    await expect(createImport(db, admin, { fornecedorId: 9999, fileName: "a.xlsx", buffer }, NOW)).rejects.toThrow(ImportError);
  });

  it("suggests the mapping, remembers the supplier's mapping and reuses it", async () => {
    const { db, admin, supplier } = await setup();
    const first = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]) }, NOW);
    expect(JSON.parse(first.mapeamentoJson!)).toMatchObject({ codigo: "Código", custo: "Preço Unitário (R$)", fabricante: "Marca" });

    await saveImportMapping(db, admin, first.id, {
      mapping: { codigo: "Código", custo: "Preço Unitário (R$)", descricao: "Descrição" },
      defaults: { categoria: "Switch", fabricante: "Genérico" },
    });
    const second = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "b.xlsx", buffer: await xlsx([HEADER, ["B1", "Outro", "X", "Y", 20, null]]) }, NOW);
    expect(JSON.parse(second.mapeamentoJson!)).toEqual({ codigo: "Código", custo: "Preço Unitário (R$)", descricao: "Descrição" });
    expect(JSON.parse(second.padroesJson)).toEqual({ categoria: "Switch", fabricante: "Genérico" });
  });

  it("validates the mapping", async () => {
    const { db, admin, supplier } = await setup();
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]) }, NOW);
    await expect(saveImportMapping(db, admin, rec.id, { mapping: { codigo: "Inexistente" }, defaults: {} })).rejects.toThrow(ImportError);
    await expect(saveImportMapping(db, admin, rec.id, { mapping: { codigo: "Código", modelo: "Código" }, defaults: {} })).rejects.toThrow(/mais de um campo/);
  });

  it("hides an import from other non-admin users", async () => {
    const { db, admin, buyer, supplier } = await setup();
    const rec = await createImport(db, buyer, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]) }, NOW);
    const other: SessionUser = { ...buyer, id: 9999 };
    await expect(analyzeImport(db, other, rec.id)).rejects.toThrow(NotFoundError);
    await analyzeImport(db, admin, rec.id); // administrador enxerga
  });
});

describe("analyzeImport", () => {
  it("classifies rows as new, updated, reconfirmed or error", async () => {
    const { db, admin, supplier } = await setup();
    // Produto existente, já com custo deste fornecedor (código do fornecedor "ALFA-1")
    const p1 = await saveProduct(db, admin, { sku: "SW-24", fabricante: "TP-Link", modelo: "Switch 24p", categoria: "Switch" });
    await addCostOffer(db, admin, { produtoId: p1.id, fornecedorId: supplier.id, skuFornecedor: "ALFA-1", custoCentavos: 100000 }, NOW);
    // Produto existente cujo SKU interno é igual ao código que o fornecedor manda
    await saveProduct(db, admin, { sku: "SSD-1T", fabricante: "Kingston", modelo: "NV2 1TB", categoria: "SSD" });

    const buffer = await xlsx([
      HEADER,
      ["ALFA-1", "Switch 24p", "TP-Link", "Switch", 1000, null], // mesmo custo → reconfirma
      ["alfa-1x", "Nobreak 1500", "SMS", "Nobreak", 1500, null], // novo
      ["SSD-1T", "SSD 1TB", "Kingston", "SSD", 380, null], // casa pelo SKU interno → atualiza (1º custo deste fornecedor)
      ["", "Sem código", "X", "Y", 10, null], // erro
      ["Z9", "Sem preço", "X", "Y", "consulte", null], // erro
      ["ALFA-1", "Switch 24p de novo", "TP-Link", "Switch", 1100, null], // repetido → erro
    ]);
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer }, NOW);
    const a = await analyzeImport(db, admin, rec.id);
    expect(a.rows.map((r) => r.status)).toEqual(["reconfirma", "novo", "atualiza", "erro", "erro", "erro"]);
    expect(a.summary).toEqual({ novo: 1, atualiza: 1, reconfirma: 1, erro: 3 });
    expect(a.rows[0].custoAnteriorCentavos).toBe(100000);
    expect(a.rows[1].novoProduto).toMatchObject({ sku: "alfa-1x", fabricante: "SMS", categoria: "Nobreak" });
    expect(a.rows[5].problemas.join()).toContain("repetido");
  });

  it("blocks new products without manufacturer or category, unless defaults are given", async () => {
    const { db, admin, supplier } = await setup();
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([["Código", "Descrição", "Preço"], ["N1", "Cabo de rede", 5]]) }, NOW);
    expect((await analyzeImport(db, admin, rec.id)).rows[0]).toMatchObject({ status: "erro" });
    await saveImportMapping(db, admin, rec.id, {
      mapping: { codigo: "Código", descricao: "Descrição", custo: "Preço" },
      defaults: { categoria: "Cabos", fabricante: "Genérico" },
    });
    const row = (await analyzeImport(db, admin, rec.id)).rows[0];
    expect(row.status).toBe("novo");
    expect(row.novoProduto).toMatchObject({ sku: "N1", fabricante: "Genérico", categoria: "Cabos", modelo: "Cabo de rede" });
  });

  it("asks for the mapping when code or cost columns are not recognized", async () => {
    const { db, admin, supplier } = await setup();
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([["X", "Y"], ["a", "b"]]) }, NOW);
    const a = await analyzeImport(db, admin, rec.id);
    expect(a.missingRequired).toEqual(["codigo", "custo"]);
    expect(a.rows).toEqual([]);
    await expect(applyImport(db, admin, rec.id, [2], NOW)).rejects.toThrow(/Associe as colunas/);
  });
});

describe("applyImport", () => {
  async function prepared() {
    const s = await setup();
    const p = await saveProduct(s.db, s.admin, { sku: "SW-24", fabricante: "TP-Link", modelo: "Switch 24p", categoria: "Switch" });
    await addCostOffer(s.db, s.admin, { produtoId: p.id, fornecedorId: s.supplier.id, skuFornecedor: "ALFA-1", custoCentavos: 100000 }, new Date(NOW.getTime() - 20 * DAY));
    const buffer = await xlsx([
      [...HEADER, "Validade"],
      ["ALFA-1", "Switch 24p", "TP-Link", "Switch", 1234.56, "https://alfa.example.com/sw24", null],
      ["ALFA-9", "Memória 16GB", "Kingston", "Memória", "R$ 210,00", null, 3],
      ["", "inválida", "X", "Y", 1, null, null],
    ]);
    const rec = await createImport(s.db, s.admin, { fornecedorId: s.supplier.id, fileName: "alfa.xlsx", buffer }, NOW);
    return { ...s, rec, produtoId: p.id };
  }

  it("creates products and cost history atomically, honoring the validity column and the category rule", async () => {
    const { db, admin, rec, produtoId } = await prepared();
    const result = await applyImport(db, admin, rec.id, [2, 3, 4], NOW);
    expect(result).toEqual({ novos: 1, atualizados: 1, reconfirmados: 0, ignorados: 1 });

    const offers = await listOffersForProduct(db, admin, produtoId);
    expect(offers).toHaveLength(2); // histórico preservado
    expect(offers[0]).toMatchObject({ custoCentavos: 123456, urlProduto: "https://alfa.example.com/sw24", skuFornecedor: "ALFA-1" });
    expect(offers[0].validoAte.getTime()).toBe(NOW.getTime() + 7 * DAY); // validade padrão (7 dias)

    const mem = await searchProducts(db, admin, "ALFA-9 memória", 10, NOW);
    expect(mem).toHaveLength(1);
    expect(mem[0].custo?.custoCentavos).toBe(21000);
    expect((await db.select().from(ofertasCusto).all()).find((o) => o.skuFornecedor === "ALFA-9")!.validoAte.getTime()).toBe(NOW.getTime() + 3 * DAY); // coluna Validade
    expect((await getProductView(db, admin, produtoId, NOW)).statusCusto).toBe("valido");
    expect((await db.select().from(auditoria).all()).some((a) => a.acao === "importacao.aplicar")).toBe(true);
  });

  it("imports only the selected rows and ignores error rows even if selected", async () => {
    const { db, admin, rec } = await prepared();
    const result = await applyImport(db, admin, rec.id, [3, 4], NOW); // linha 4 tem erro
    expect(result).toMatchObject({ novos: 1, atualizados: 0 });
    expect((await db.select().from(produtos).all()).filter((p) => p.sku === "ALFA-9")).toHaveLength(1);
    expect(await db.select().from(ofertasCusto).all()).toHaveLength(2); // 1 antiga + 1 nova
  });

  it("cannot be applied twice, after expiry, or with nothing selected; and needs permission", async () => {
    const { db, admin, seller, rec } = await prepared();
    await expect(applyImport(db, admin, rec.id, [], NOW)).rejects.toThrow(/Nenhuma linha/);
    await expect(applyImport(db, seller, rec.id, [2], NOW)).rejects.toThrow(ForbiddenError);
    await expect(applyImport(db, admin, rec.id, [2], new Date(NOW.getTime() + 25 * 3600_000))).rejects.toThrow(/expirou/);
    await applyImport(db, admin, rec.id, [2], NOW);
    await expect(applyImport(db, admin, rec.id, [2], NOW)).rejects.toThrow(/já foi concluída/);
    expect(await db.select().from(ofertasCusto).all()).toHaveLength(2);
  });

  it("stores hostile cell text as plain text", async () => {
    const { db, admin, supplier } = await setup();
    const buffer = await xlsx([HEADER, ["H1", "=HYPERLINK(\"http://evil\")", "<img src=x onerror=alert(1)>", "Teste", 10, "javascript:alert(1)"]]);
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "../../etc/passwd\u0000.xlsx", buffer }, NOW);
    expect(rec.nomeArquivo).not.toContain("\u0000");
    await applyImport(db, admin, rec.id, [2], NOW);
    const p = (await db.select().from(produtos).all()).find((x) => x.sku === "H1")!;
    expect(p.fabricante).toBe("<img src=x onerror=alert(1)>");
    expect((await db.select().from(ofertasCusto).all())[0].urlProduto).toBeNull(); // link javascript: descartado
  });

  it("applies hundreds of rows in batches, linking every offer to the right product", async () => {
    const { db, admin, supplier } = await setup();
    const existing = 230;
    const fresh = 270; // atravessa os lotes de gravação (100 linhas)
    for (let i = 0; i < existing; i++) await saveProduct(db, admin, { sku: `E${i}`, fabricante: "Marca", modelo: `Existente ${i}`, categoria: "Cat" }, NOW);
    const rows = [
      ...Array.from({ length: existing }, (_, i) => [`E${i}`, "x", "Marca", "Cat", 10 + i, null]),
      ...Array.from({ length: fresh }, (_, i) => [`N${i}`, `Novo ${i}`, "Marca", "Cat", 500 + i, null]),
    ];
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "grande.xlsx", buffer: await xlsx([HEADER, ...rows]) }, NOW);
    const result = await applyImport(db, admin, rec.id, rows.map((_, i) => i + 2), NOW);
    expect(result).toEqual({ novos: fresh, atualizados: existing, reconfirmados: 0, ignorados: 0 });

    const bySku = new Map((await db.select().from(produtos).all()).map((p) => [p.sku, p.id]));
    const offers = await db.select().from(ofertasCusto).all();
    expect(offers).toHaveLength(existing + fresh);
    for (const o of offers) expect(o.produtoId).toBe(bySku.get(o.skuFornecedor!)); // oferta ligada ao produto certo
    expect(offers.find((o) => o.skuFornecedor === "N269")!.custoCentavos).toBe((500 + 269) * 100);
    const acoes = (await db.select().from(auditoria).all()).map((a) => a.acao);
    expect(acoes.filter((a) => a === "produto.criar")).toHaveLength(existing + fresh); // inclui os criados no preparo
    expect(acoes.filter((a) => a === "oferta_custo.criar")).toHaveLength(existing + fresh);
  }, 60_000);

  it("treats a code repeated in the sheet as an error row and imports the rest", async () => {
    const { db, admin, supplier } = await setup();
    const buffer = await xlsx([HEADER, ["D1", "Um", "Marca", "Cat", 10, null], ["D2", "Dois", "Marca", "Cat", 20, null], ["D1", "Um de novo", "Marca", "Cat", 30, null]]);
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "dup.xlsx", buffer }, NOW);
    expect(await applyImport(db, admin, rec.id, [2, 3, 4], NOW)).toMatchObject({ novos: 2, ignorados: 1 });
    expect(await db.select().from(produtos).all()).toHaveLength(2);
  });

  it("createProducts is all-or-nothing: repeated or existing SKUs store nothing", async () => {
    const { db, admin } = await setup();
    const mk = (sku: string) => ({ sku, fabricante: "M", modelo: sku, categoria: "C" });
    await expect(createProducts(db, admin, [mk("A"), mk("B"), mk("A")], NOW)).rejects.toThrow(ValidationError);
    expect(await db.select().from(produtos).all()).toHaveLength(0);
    await saveProduct(db, admin, mk("X"), NOW);
    await expect(createProducts(db, admin, [mk("Y"), mk("X")], NOW)).rejects.toThrow(/Já existe/);
    expect(await db.select().from(produtos).all()).toHaveLength(1);
    expect((await createProducts(db, admin, [mk("P"), mk("Q")], NOW)).map((p) => p.sku)).toEqual(["P", "Q"]);
  });
});
