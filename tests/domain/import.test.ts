import { describe, expect, it } from "vitest";
import { autoMap, cellToCents, cellToText, parseRows, type CellValue } from "@/domain/import";

describe("autoMap", () => {
  it("recognizes common supplier headers, ignoring case and accents", () => {
    expect(autoMap(["Código", "Descrição do Produto", "Marca", "Preço Unitário (R$)", "Link"])).toEqual({
      codigo: "Código",
      descricao: "Descrição do Produto",
      fabricante: "Marca",
      custo: "Preço Unitário (R$)",
      link: "Link",
    });
  });
  it("uses part number as code and does not map one header twice", () => {
    const m = autoMap(["Part Number", "Modelo", "Categoria", "Valor", "Validade (dias)"]);
    expect(m).toMatchObject({ codigo: "Part Number", modelo: "Modelo", categoria: "Categoria", custo: "Valor", validadeDias: "Validade (dias)" });
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });
  it("recognizes headers by keyword when the exact name is not listed", () => {
    expect(autoMap(["Cód. Fornecedor", "Descrição Resumida", "Preço c/ IPI", "Marca/Fabricante"])).toEqual({
      codigo: "Cód. Fornecedor",
      descricao: "Descrição Resumida",
      custo: "Preço c/ IPI",
      fabricante: "Marca/Fabricante",
    });
    // "Código do Produto" é o código; a descrição vem da outra coluna
    expect(autoMap(["Código do Produto", "Descrição"])).toEqual({ codigo: "Código do Produto", descricao: "Descrição" });
  });
  it("returns nothing for unknown headers", () => {
    expect(autoMap(["Coluna A", "Coluna B"])).toEqual({});
  });
});

describe("cellToCents", () => {
  it.each([
    [1234.56, 123456],
    [10, 1000],
    [0.1 + 0.2, 30], // erro de ponto flutuante não pode vazar
    [19.995, 2000],
    ["1.234,56", 123456],
    ["R$ 99,90", 9990],
    ["1234.5", 123450],
  ])("converts %s", (v, expected) => {
    expect(cellToCents(v as CellValue)).toBe(expected);
  });
  it.each([0, -5, "", "abc", null, NaN, Infinity, "0,00"])("rejects %s", (v) => {
    expect(cellToCents(v as CellValue)).toBeNull();
  });
});

describe("cellToText", () => {
  it("trims, drops control characters and caps the length", () => {
    expect(cellToText("  Switch\u0000 24p\u0007 ", 50)).toBe("Switch 24p");
    expect(cellToText(12345, 50)).toBe("12345");
    expect(cellToText(12345.0, 50)).toBe("12345");
    expect(cellToText(null, 50)).toBe("");
    expect(cellToText("x".repeat(100), 10)).toHaveLength(10);
  });
});

describe("parseRows", () => {
  const headers = ["Cod", "Descrição", "Marca", "Preço", "Link", "Validade"];
  const mapping = { codigo: "Cod", descricao: "Descrição", fabricante: "Marca", custo: "Preço", link: "Link", validadeDias: "Validade" };

  it("parses valid rows and reports row numbers (header is row 1)", () => {
    const rows: CellValue[][] = [["SW-1", "Switch 24 portas", "TP-Link", 1890, "https://x.com/p", 3]];
    const [r] = parseRows(headers, rows, mapping, {});
    expect(r).toMatchObject({ rowNumber: 2, codigo: "SW-1", descricao: "Switch 24 portas", fabricante: "TP-Link", custoCentavos: 189000, link: "https://x.com/p", validadeDias: 3 });
    expect(r.errors).toEqual([]);
  });

  it("flags missing code and invalid cost as errors", () => {
    const rows: CellValue[][] = [["", "Sem código", "X", 10, null, null], ["A1", "Sem preço", "X", "n/d", null, null]];
    const [a, b] = parseRows(headers, rows, mapping, {});
    expect(a.errors.join()).toContain("Código");
    expect(b.errors.join()).toContain("Custo");
  });

  it("drops invalid links and validity with a warning instead of failing the row", () => {
    const rows: CellValue[][] = [["A1", "Item", "X", 10, "javascript:alert(1)", 9999]];
    const [r] = parseRows(headers, rows, mapping, {});
    expect(r.errors).toEqual([]);
    expect(r.link).toBeUndefined();
    expect(r.validadeDias).toBeUndefined();
    expect(r.warnings.length).toBe(2);
  });

  it("applies defaults for category and manufacturer when the columns are missing", () => {
    const rows: CellValue[][] = [["A1", "Item", null, 10, null, null]];
    const [r] = parseRows(headers, rows, mapping, { categoria: "Switch", fabricante: "Genérico" });
    expect(r).toMatchObject({ categoria: "Switch", fabricante: "Genérico" });
  });

  it("marks repeated codes inside the same file", () => {
    const rows: CellValue[][] = [["A1", "Item", "X", 10, null, null], ["a1", "Item de novo", "X", 11, null, null]];
    const [first, second] = parseRows(headers, rows, mapping, {});
    expect(first.errors).toEqual([]);
    expect(second.errors.join()).toContain("repetido");
  });

  it("treats hostile text as plain text (no formulas are evaluated, nothing is stripped but control chars)", () => {
    const rows: CellValue[][] = [["A1", "=HYPERLINK(\"http://x\")<script>", "X", 10, null, null]];
    const [r] = parseRows(headers, rows, mapping, {});
    expect(r.descricao).toBe("=HYPERLINK(\"http://x\")<script>");
  });
});
