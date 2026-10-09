import { describe, expect, it } from "vitest";
import { buildQuotePdf } from "@/server/export/pdf";
import type { QuoteClientView } from "@/server/quotes/views";

function make(n: number, clientName = "Indústria São João <b>Ltda</b>"): QuoteClientView {
  return {
    numero: "2026-0001",
    emitidoEm: new Date("2026-10-09T12:00:00Z"),
    validoAte: new Date("2026-10-24T12:00:00Z"),
    empresa: { nome: "Tech Master Informática", cnpj: "", endereco: "", telefone: "(11) 5555-0000", email: "v@tm.com" },
    cliente: { razaoSocial: clientName, cnpj: "11222333000181", contato: "Ação", email: null, telefone: null },
    itens: Array.from({ length: n }, (_, i) => ({
      descricao: `Switch 24 portas PoE — item ${i + 1} com descrição bem longa para quebrar linha na tabela do PDF`,
      quantidade: 2,
      precoUnitarioCentavos: 125000,
      descontoBps: i % 2 === 0 ? 500 : 0,
      totalCentavos: 250000,
    })),
    subtotalCentavos: 250000 * n,
    descontoCentavos: 0,
    freteCentavos: 5000,
    totalCentavos: 250000 * n + 5000,
    condicoesPagamento: "À vista",
    prazoEntrega: "5 dias úteis",
    garantia: "12 meses",
    observacoes: "",
  };
}

describe("buildQuotePdf", () => {
  it("renders a valid PDF with one item and with many pages", async () => {
    const one = await buildQuotePdf(make(1));
    expect(one.subarray(0, 5).toString()).toBe("%PDF-");
    const many = await buildQuotePdf(make(60));
    expect(many.subarray(0, 5).toString()).toBe("%PDF-");
    expect(many.length).toBeGreaterThan(one.length);
  }, 30_000);

  it("does not fail without a logo or with hostile text", async () => {
    const pdf = await buildQuotePdf(make(3, "=HYPERLINK(\"x\") <script>alert(1)</script> \"áéíõç\""), {});
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});
