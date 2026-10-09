import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildQuoteXlsx, neutralizeFormula } from "@/server/export/xlsx";
import type { QuoteClientView } from "@/server/quotes/views";

const view: QuoteClientView = {
  numero: "2026-0001",
  emitidoEm: new Date("2026-10-09T12:00:00Z"),
  validoAte: new Date("2026-10-24T12:00:00Z"),
  empresa: { nome: "Tech Master", cnpj: "", endereco: "", telefone: "", email: "" },
  cliente: { razaoSocial: "=cmd|' /C calc'!A0", cnpj: null, contato: "Ana", email: null, telefone: null },
  itens: [
    { descricao: '=HYPERLINK("http://x","y")', quantidade: 2, precoUnitarioCentavos: 125000, descontoBps: 0, totalCentavos: 250000 },
    { descricao: "SSD 1TB", quantidade: 1, precoUnitarioCentavos: 50000, descontoBps: 500, totalCentavos: 47500 },
  ],
  subtotalCentavos: 300000,
  descontoCentavos: 2500,
  freteCentavos: 0,
  totalCentavos: 297500,
  condicoesPagamento: "À vista",
  prazoEntrega: "5 dias",
  garantia: "12 meses",
  observacoes: "",
};

describe("neutralizeFormula", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx"])("prefixes %j", (t) => {
    expect(neutralizeFormula(t)).toBe(`'${t}`);
  });
  it("keeps normal text", () => {
    expect(neutralizeFormula("Nobreak 1500VA")).toBe("Nobreak 1500VA");
  });
});

describe("buildQuoteXlsx", () => {
  it("writes items and totals, neutralizes formulas, never mentions cost or margin", async () => {
    const buf = await buildQuoteXlsx(view);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];

    const all: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => all.push(String(c.value))));
    expect(all).toContain("'=HYPERLINK(\"http://x\",\"y\")");
    expect(all).toContain("'=cmd|' /C calc'!A0");
    expect(all.some((v) => /custo|margem/i.test(v))).toBe(false);

    const itemRow = ws.getRow(10);
    expect(itemRow.getCell(3).value).toBe(2);
    expect(itemRow.getCell(4).value).toBe(1250);
    expect(itemRow.getCell(6).value).toBe(2500);

    let total: unknown;
    ws.eachRow((row) => {
      if (row.getCell(5).value === "TOTAL") total = row.getCell(6).value;
    });
    expect(total).toBe(2975);
  });
});
