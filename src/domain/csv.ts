import type { CellValue } from "./import";

/** Texto do arquivo: UTF-8 quando válido; senão Windows-1252 (padrão dos CSVs gerados por Excel/ERPs brasileiros). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Separador mais provável, pela primeira linha com conteúdo (fora de aspas). */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0, "|": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length && i < 20_000; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "\n") break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  // Ponto e vírgula vence vírgula em empate: é o padrão do Excel em português e a vírgula é decimal.
  return (Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === ";" ? -1 : 1))[0] ?? [";"])[0];
}

/** Lê CSV (aspas, aspas duplas escapadas, quebras de linha dentro de aspas). Devolve a grade de textos. */
export function parseCsv(text: string): CellValue[][] {
  const delimiter = detectDelimiter(text);
  const rows: CellValue[][] = [];
  let row: CellValue[] = [];
  let field = "";
  let inQuotes = false;
  let wasQuoted = false;

  const endField = () => {
    row.push(field === "" && !wasQuoted ? null : field);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((v) => v !== null && String(v).trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === delimiter) endField();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
  }
  if (field !== "" || wasQuoted || row.length > 0) endRow();
  return rows;
}
