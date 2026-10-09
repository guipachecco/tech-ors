import ExcelJS from "exceljs";
import { formatDate } from "../../domain/format";
import { formatCnpj } from "../../domain/cnpj";
import type { QuoteClientView } from "../quotes/views";

/** Evita que texto digitado seja interpretado como fórmula pelo Excel. */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const money = "R$ #,##0.00";
const reais = (cents: number) => cents / 100;

export async function buildQuoteXlsx(view: QuoteClientView): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = view.empresa.nome;
  const ws = wb.addWorksheet(`Orçamento ${view.numero}`.slice(0, 31));
  ws.columns = [
    { width: 6 },
    { width: 60 },
    { width: 12 },
    { width: 18 },
    { width: 12 },
    { width: 18 },
  ];

  const text = (row: number, label: string, value: string) => {
    ws.getCell(row, 1).value = neutralizeFormula(label);
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 2).value = neutralizeFormula(value);
  };

  ws.getCell(1, 1).value = neutralizeFormula(view.empresa.nome);
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  text(2, "Orçamento", view.numero);
  text(3, "Emissão", formatDate(view.emitidoEm));
  text(4, "Validade", formatDate(view.validoAte));
  text(5, "Cliente", view.cliente.razaoSocial);
  text(6, "CNPJ", view.cliente.cnpj ? formatCnpj(view.cliente.cnpj) : "");
  text(7, "Contato", view.cliente.contato ?? "");

  const headerRow = 9;
  ["Item", "Descrição", "Qtd", "Valor unitário", "Desc. %", "Total"].forEach((h, i) => {
    const c = ws.getCell(headerRow, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });

  view.itens.forEach((it, idx) => {
    const r = headerRow + 1 + idx;
    ws.getCell(r, 1).value = idx + 1;
    ws.getCell(r, 2).value = neutralizeFormula(it.detalhes ? `${it.descricao}\n${it.detalhes}` : it.descricao);
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(r, 3).value = it.quantidade;
    ws.getCell(r, 4).value = reais(it.precoUnitarioCentavos);
    ws.getCell(r, 4).numFmt = money;
    ws.getCell(r, 5).value = it.descontoBps / 10000;
    ws.getCell(r, 5).numFmt = "0.00%";
    ws.getCell(r, 6).value = reais(it.totalCentavos);
    ws.getCell(r, 6).numFmt = money;
  });

  let r = headerRow + view.itens.length + 2;
  const total = (label: string, cents: number, bold = false) => {
    ws.getCell(r, 5).value = label;
    ws.getCell(r, 5).font = { bold };
    ws.getCell(r, 6).value = reais(cents);
    ws.getCell(r, 6).numFmt = money;
    ws.getCell(r, 6).font = { bold };
    r++;
  };
  total("Subtotal", view.subtotalCentavos);
  if (view.descontoCentavos > 0) total("Descontos", -view.descontoCentavos);
  if (view.freteCentavos > 0) total("Frete", view.freteCentavos);
  total("TOTAL", view.totalCentavos, true);

  r += 1;
  text(r++, "Pagamento", view.condicoesPagamento);
  text(r++, "Prazo de entrega", view.prazoEntrega);
  text(r++, "Garantia", view.garantia);
  if (view.observacoes) text(r++, "Observações", view.observacoes);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
