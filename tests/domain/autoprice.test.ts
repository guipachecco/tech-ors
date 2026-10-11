import { describe, expect, it } from "vitest";
import { decodeCsvBytes, parseCsv } from "@/domain/csv";
import { needsReview, variationBps } from "@/domain/priceChange";
import { toDirectDownloadUrl } from "@/domain/sourceUrl";

describe("parseCsv", () => {
  it("reads semicolon CSV with decimal commas and keeps values as text", () => {
    expect(parseCsv("Código;Preço\nA1;1.234,56\nA2;99,90\n")).toEqual([["Código", "Preço"], ["A1", "1.234,56"], ["A2", "99,90"]]);
  });

  it("reads comma and tab separated files", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\r\n1\t2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles quotes, escaped quotes, embedded delimiters and newlines", () => {
    const rows = parseCsv('sku;desc\nA1;"Cabo ""HDMI"", 2m; preto"\nA2;"linha 1\nlinha 2"\n');
    expect(rows[1]).toEqual(["A1", 'Cabo "HDMI", 2m; preto']);
    expect(rows[2]).toEqual(["A2", "linha 1\nlinha 2"]);
  });

  it("turns empty unquoted cells into null and skips blank lines", () => {
    expect(parseCsv("a;b;c\n1;;3\n\n;;\n")).toEqual([["a", "b", "c"], ["1", null, "3"]]);
  });

  it("handles a last line without a trailing newline", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("decodeCsvBytes", () => {
  it("decodes UTF-8 (with BOM) and falls back to Windows-1252", () => {
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x43, 0xc3, 0xb3, 0x64]))).toBe("Cód");
    expect(decodeCsvBytes(new Uint8Array([0x43, 0xf3, 0x64]))).toBe("Cód"); // 0xF3 = ó em Windows-1252
  });
});

describe("price change guard", () => {
  it("measures the variation against the previous cost", () => {
    expect(variationBps(10_000, 11_000)).toBe(1000);
    expect(variationBps(10_000, 9_000)).toBe(1000);
    expect(variationBps(10_000, 10_000)).toBe(0);
  });

  it("flags only variations above the limit", () => {
    expect(needsReview(10_000, 13_000, 3000)).toBe(false); // exatamente 30% passa
    expect(needsReview(10_000, 13_001, 3000)).toBe(true);
    expect(needsReview(10_000, 6_000, 3000)).toBe(true); // queda grande também merece olhar (preço errado)
  });
});

describe("toDirectDownloadUrl", () => {
  it("converts Google Sheets, Drive and Dropbox share links", () => {
    expect(toDirectDownloadUrl("https://docs.google.com/spreadsheets/d/abc_123-X/edit#gid=0")).toBe("https://docs.google.com/spreadsheets/d/abc_123-X/export?format=xlsx");
    expect(toDirectDownloadUrl("https://drive.google.com/file/d/FILE-1/view?usp=sharing")).toBe("https://drive.google.com/uc?export=download&id=FILE-1");
    expect(toDirectDownloadUrl("https://www.dropbox.com/s/xyz/precos.xlsx?dl=0")).toBe("https://www.dropbox.com/s/xyz/precos.xlsx?dl=1");
  });

  it("leaves other links alone", () => {
    expect(toDirectDownloadUrl("https://fornecedor.com.br/lista.csv")).toBe("https://fornecedor.com.br/lista.csv");
  });
});
