import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/sessions";
import { listOffersForProduct } from "@/server/catalog/offers";
import { getProductView, saveProduct, searchProducts } from "@/server/catalog/products";
import { addCostOffer } from "@/server/catalog/offers";
import { saveSupplier } from "@/server/catalog/suppliers";
import {
  analyzeImport, applyImport, assertSafeXlsx, createImport, ImportError, MAX_ROWS, readSheet, saveImportMapping,
} from "@/server/catalog/import";
import { auditoria, ofertasCusto, produtos, usuarios } from "@/server/db/schema";
import { NotFoundError } from "@/server/validation";
import { createTestDb } from "./helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;

async function xlsx(rows: unknown[][], opts: { sheetName?: string } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName ?? "Preços");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function setup() {
  const db = createTestDb();
  const mk = (nome: string, perfil: "administrador" | "vendedor", podeVerCusto: boolean): SessionUser => {
    const u = db.insert(usuarios).values({ nome, email: `${nome}@x.com`, senhaHash: "h", perfil, podeVerCusto }).returning().get();
    return { id: u.id, nome, email: u.email, perfil, podeVerCusto };
  };
  const admin = mk("adm", "administrador", true);
  const seller = mk("ven", "vendedor", false);
  const buyer = mk("comp", "vendedor", true); // vendedor com permissão de custo
  const supplier = saveSupplier(db, admin, { nome: "Distribuidora Alfa" });
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
    const { db, seller, admin, supplier } = setup();
    const buffer = await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]);
    await expect(createImport(db, seller, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer }, NOW)).rejects.toThrow(ForbiddenError);
    await expect(createImport(db, admin, { fornecedorId: 9999, fileName: "a.xlsx", buffer }, NOW)).rejects.toThrow(ImportError);
  });

  it("suggests the mapping, remembers the supplier's mapping and reuses it", async () => {
    const { db, admin, supplier } = setup();
    const first = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]) }, NOW);
    expect(JSON.parse(first.mapeamentoJson!)).toMatchObject({ codigo: "Código", custo: "Preço Unitário (R$)", fabricante: "Marca" });

    saveImportMapping(db, admin, first.id, {
      mapping: { codigo: "Código", custo: "Preço Unitário (R$)", descricao: "Descrição" },
      defaults: { categoria: "Switch", fabricante: "Genérico" },
    });
    const second = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "b.xlsx", buffer: await xlsx([HEADER, ["B1", "Outro", "X", "Y", 20, null]]) }, NOW);
    expect(JSON.parse(second.mapeamentoJson!)).toEqual({ codigo: "Código", custo: "Preço Unitário (R$)", descricao: "Descrição" });
    expect(JSON.parse(second.padroesJson)).toEqual({ categoria: "Switch", fabricante: "Genérico" });
  });

  it("validates the mapping", async () => {
    const { db, admin, supplier } = setup();
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]) }, NOW);
    expect(() => saveImportMapping(db, admin, rec.id, { mapping: { codigo: "Inexistente" }, defaults: {} })).toThrow(ImportError);
    expect(() => saveImportMapping(db, admin, rec.id, { mapping: { codigo: "Código", modelo: "Código" }, defaults: {} })).toThrow(/mais de um campo/);
  });

  it("hides an import from other non-admin users", async () => {
    const { db, admin, buyer, supplier } = setup();
    const rec = await createImport(db, buyer, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([HEADER, ["A1", "Item", "X", "Y", 10, null]]) }, NOW);
    const other: SessionUser = { ...buyer, id: 9999 };
    expect(() => analyzeImport(db, other, rec.id)).toThrow(NotFoundError);
    expect(() => analyzeImport(db, admin, rec.id)).not.toThrow(); // administrador enxerga
  });
});

describe("analyzeImport", () => {
  it("classifies rows as new, updated, reconfirmed or error", async () => {
    const { db, admin, supplier } = setup();
    // Produto existente, já com custo deste fornecedor (código do fornecedor "ALFA-1")
    const p1 = saveProduct(db, admin, { sku: "SW-24", fabricante: "TP-Link", modelo: "Switch 24p", categoria: "Switch" });
    addCostOffer(db, admin, { produtoId: p1.id, fornecedorId: supplier.id, skuFornecedor: "ALFA-1", custoCentavos: 100000 }, NOW);
    // Produto existente cujo SKU interno é igual ao código que o fornecedor manda
    saveProduct(db, admin, { sku: "SSD-1T", fabricante: "Kingston", modelo: "NV2 1TB", categoria: "SSD" });

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
    const a = analyzeImport(db, admin, rec.id);
    expect(a.rows.map((r) => r.status)).toEqual(["reconfirma", "novo", "atualiza", "erro", "erro", "erro"]);
    expect(a.summary).toEqual({ novo: 1, atualiza: 1, reconfirma: 1, erro: 3 });
    expect(a.rows[0].custoAnteriorCentavos).toBe(100000);
    expect(a.rows[1].novoProduto).toMatchObject({ sku: "alfa-1x", fabricante: "SMS", categoria: "Nobreak" });
    expect(a.rows[5].problemas.join()).toContain("repetido");
  });

  it("blocks new products without manufacturer or category, unless defaults are given", async () => {
    const { db, admin, supplier } = setup();
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([["Código", "Descrição", "Preço"], ["N1", "Cabo de rede", 5]]) }, NOW);
    expect(analyzeImport(db, admin, rec.id).rows[0]).toMatchObject({ status: "erro" });
    saveImportMapping(db, admin, rec.id, {
      mapping: { codigo: "Código", descricao: "Descrição", custo: "Preço" },
      defaults: { categoria: "Cabos", fabricante: "Genérico" },
    });
    const row = analyzeImport(db, admin, rec.id).rows[0];
    expect(row.status).toBe("novo");
    expect(row.novoProduto).toMatchObject({ sku: "N1", fabricante: "Genérico", categoria: "Cabos", modelo: "Cabo de rede" });
  });

  it("asks for the mapping when code or cost columns are not recognized", async () => {
    const { db, admin, supplier } = setup();
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "a.xlsx", buffer: await xlsx([["X", "Y"], ["a", "b"]]) }, NOW);
    const a = analyzeImport(db, admin, rec.id);
    expect(a.missingRequired).toEqual(["codigo", "custo"]);
    expect(a.rows).toEqual([]);
    expect(() => applyImport(db, admin, rec.id, [2], NOW)).toThrow(/Associe as colunas/);
  });
});

describe("applyImport", () => {
  async function prepared() {
    const s = setup();
    const p = saveProduct(s.db, s.admin, { sku: "SW-24", fabricante: "TP-Link", modelo: "Switch 24p", categoria: "Switch" });
    addCostOffer(s.db, s.admin, { produtoId: p.id, fornecedorId: s.supplier.id, skuFornecedor: "ALFA-1", custoCentavos: 100000 }, new Date(NOW.getTime() - 20 * DAY));
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
    const result = applyImport(db, admin, rec.id, [2, 3, 4], NOW);
    expect(result).toEqual({ novos: 1, atualizados: 1, reconfirmados: 0, ignorados: 1 });

    const offers = listOffersForProduct(db, admin, produtoId);
    expect(offers).toHaveLength(2); // histórico preservado
    expect(offers[0]).toMatchObject({ custoCentavos: 123456, urlProduto: "https://alfa.example.com/sw24", skuFornecedor: "ALFA-1" });
    expect(offers[0].validoAte.getTime()).toBe(NOW.getTime() + 7 * DAY); // validade padrão (7 dias)

    const mem = searchProducts(db, admin, "ALFA-9 memória", 10, NOW);
    expect(mem).toHaveLength(1);
    expect(mem[0].custo?.custoCentavos).toBe(21000);
    expect(db.select().from(ofertasCusto).all().find((o) => o.skuFornecedor === "ALFA-9")!.validoAte.getTime()).toBe(NOW.getTime() + 3 * DAY); // coluna Validade
    expect(getProductView(db, admin, produtoId, NOW).statusCusto).toBe("valido");
    expect(db.select().from(auditoria).all().some((a) => a.acao === "importacao.aplicar")).toBe(true);
  });

  it("imports only the selected rows and ignores error rows even if selected", async () => {
    const { db, admin, rec } = await prepared();
    const result = applyImport(db, admin, rec.id, [3, 4], NOW); // linha 4 tem erro
    expect(result).toMatchObject({ novos: 1, atualizados: 0 });
    expect(db.select().from(produtos).all().filter((p) => p.sku === "ALFA-9")).toHaveLength(1);
    expect(db.select().from(ofertasCusto).all()).toHaveLength(2); // 1 antiga + 1 nova
  });

  it("cannot be applied twice, after expiry, or with nothing selected; and needs permission", async () => {
    const { db, admin, seller, rec } = await prepared();
    expect(() => applyImport(db, admin, rec.id, [], NOW)).toThrow(/Nenhuma linha/);
    expect(() => applyImport(db, seller, rec.id, [2], NOW)).toThrow(ForbiddenError);
    expect(() => applyImport(db, admin, rec.id, [2], new Date(NOW.getTime() + 25 * 3600_000))).toThrow(/expirou/);
    applyImport(db, admin, rec.id, [2], NOW);
    expect(() => applyImport(db, admin, rec.id, [2], NOW)).toThrow(/já foi concluída/);
    expect(db.select().from(ofertasCusto).all()).toHaveLength(2);
  });

  it("stores hostile cell text as plain text", async () => {
    const { db, admin, supplier } = setup();
    const buffer = await xlsx([HEADER, ["H1", "=HYPERLINK(\"http://evil\")", "<img src=x onerror=alert(1)>", "Teste", 10, "javascript:alert(1)"]]);
    const rec = await createImport(db, admin, { fornecedorId: supplier.id, fileName: "../../etc/passwd\u0000.xlsx", buffer }, NOW);
    expect(rec.nomeArquivo).not.toContain("\u0000");
    applyImport(db, admin, rec.id, [2], NOW);
    const p = db.select().from(produtos).all().find((x) => x.sku === "H1")!;
    expect(p.fabricante).toBe("<img src=x onerror=alert(1)>");
    expect(db.select().from(ofertasCusto).all()[0].urlProduto).toBeNull(); // link javascript: descartado
  });
});
