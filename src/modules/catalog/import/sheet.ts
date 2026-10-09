// Leitura segura de planilhas .xlsx: confere o arquivo antes de abrir e devolve cabeçalho + linhas.
import ExcelJS from "exceljs";
import { cellToText, type CellValue } from "@/domain/import";

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // a Vercel recusa requisições acima de ~4,5 MB
export const MAX_ROWS = 2000;
export const MAX_COLS = 40;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

/** Erro com mensagem própria para o usuário (arquivo inválido, planilha grande demais etc.). */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

// ---------- leitura segura do arquivo ----------

/**
 * Confere o arquivo antes de abri-lo: é um .xlsx (zip) de tamanho razoável e não expande para
 * um tamanho absurdo (zip bomb). Lê só o diretório central do zip, sem descompactar nada.
 */
export function assertSafeXlsx(buf: Buffer): void {
  if (buf.length === 0) throw new ImportError("O arquivo está vazio.");
  if (buf.length > MAX_FILE_BYTES) throw new ImportError(`O arquivo passa de ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new ImportError("O arquivo não é uma planilha .xlsx válida (salve como “Pasta de Trabalho do Excel”).");

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError("O arquivo está corrompido ou não é um .xlsx válido.");
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ZIP_ENTRIES) throw new ImportError("O arquivo tem itens demais para ser uma planilha comum.");

  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new ImportError("O arquivo está corrompido.");
    total += buf.readUInt32LE(offset + 24);
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
    if (total > MAX_UNCOMPRESSED_BYTES) throw new ImportError("A planilha descompactada é grande demais.");
  }
}

function cellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("error" in o) return null;
    if ("result" in o) return cellValue(o.result); // fórmula: vale o resultado calculado
    if ("richText" in o && Array.isArray(o.richText)) return o.richText.map((p) => String((p as { text?: string }).text ?? "")).join("");
    if ("text" in o) return cellValue(o.text) ?? (typeof o.hyperlink === "string" ? o.hyperlink : null);
    if ("hyperlink" in o && typeof o.hyperlink === "string") return o.hyperlink;
  }
  return null;
}

export type Sheet = { headers: string[]; rows: CellValue[][] };

export async function readSheet(buffer: Buffer): Promise<Sheet> {
  assertSafeXlsx(buffer);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportError("Não consegui abrir a planilha. Confirme que é um arquivo .xlsx.");
  }
  const ws = wb.worksheets.find((s) => s.actualRowCount > 0);
  if (!ws) throw new ImportError("A planilha está vazia.");
  if (ws.rowCount > 50_000) throw new ImportError("A planilha tem linhas demais (máx. 2.000 itens).");
  if (ws.actualColumnCount > MAX_COLS) throw new ImportError(`A planilha tem mais de ${MAX_COLS} colunas.`);

  const cols = Math.min(ws.columnCount, MAX_COLS);
  const grid: CellValue[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: CellValue[] = [];
    for (let c = 1; c <= cols; c++) values.push(cellValue(row.getCell(c).value));
    grid.push(values);
  });

  // Cabeçalho: primeira linha (entre as 20 primeiras) com pelo menos 2 textos; linhas de título ficam de fora.
  const headerIdx = grid.slice(0, 20).findIndex((r) => r.filter((v) => typeof v === "string" && v.trim() !== "").length >= 2);
  if (headerIdx < 0) throw new ImportError("Não encontrei a linha de cabeçalho (nomes das colunas) nas primeiras linhas.");

  const seen = new Map<string, number>();
  const headers = grid[headerIdx].map((v, i) => {
    const base = cellToText(v, 80) || `Coluna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });

  const rows = grid.slice(headerIdx + 1).filter((r) => r.some((v) => v !== null && cellToText(v, 5) !== ""));
  if (rows.length === 0) throw new ImportError("A planilha tem cabeçalho, mas nenhuma linha de produtos.");
  if (rows.length > MAX_ROWS) throw new ImportError(`A planilha tem ${rows.length} linhas; o máximo é ${MAX_ROWS}. Divida o arquivo.`);
  return { headers, rows };
}
