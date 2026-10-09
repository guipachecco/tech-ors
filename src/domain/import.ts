import { parseBRL, type Cents } from "./money";
import { normalizeSearch } from "./search";

export type CellValue = string | number | null;

export const FIELDS = ["codigo", "fabricante", "modelo", "categoria", "descricao", "custo", "link", "validadeDias"] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, string>>;
export type Defaults = { categoria?: string; fabricante?: string };

export const FIELD_LABELS: Record<Field, string> = {
  codigo: "Código / SKU do fornecedor",
  fabricante: "Fabricante / marca",
  modelo: "Modelo",
  categoria: "Categoria",
  descricao: "Descrição",
  custo: "Custo (R$)",
  link: "Link do produto",
  validadeDias: "Validade do custo (dias)",
};

// Nomes de coluna comuns em planilhas de fornecedores (já normalizados: minúsculas, sem acento).
const SYNONYMS: Record<Field, string[]> = {
  codigo: ["codigo", "cod", "sku", "part number", "partnumber", "pn", "p n", "referencia", "ref", "codigo produto", "codigo do produto", "cod produto", "item"],
  fabricante: ["fabricante", "marca", "brand", "manufacturer"],
  modelo: ["modelo", "model"],
  categoria: ["categoria", "familia", "grupo", "linha", "segmento", "tipo"],
  descricao: ["descricao", "descricao do produto", "descricao produto", "produto", "nome", "nome do produto", "titulo", "description"],
  custo: ["custo", "preco", "preco unitario", "valor", "valor unitario", "preco de custo", "preco custo", "price", "unit price", "preco r", "valor r", "preco revenda"],
  link: ["link", "url", "site", "pagina"],
  validadeDias: ["validade", "validade dias", "validade do preco", "validade do custo"],
};

// Palavras soltas que identificam o campo quando o cabeçalho não bate exatamente (ex.: "Cód. Fornecedor").
const KEYWORDS: Record<Field, string[]> = {
  codigo: ["codigo", "cod", "sku", "pn", "referencia", "ref"],
  fabricante: ["fabricante", "marca", "brand"],
  modelo: ["modelo", "model"],
  categoria: ["categoria", "familia", "grupo", "linha", "segmento"],
  descricao: ["descricao", "description", "produto", "nome", "titulo"],
  custo: ["preco", "custo", "valor", "price"],
  link: ["link", "url", "site"],
  validadeDias: ["validade"],
};

/** Sugere o mapeamento de colunas pelos nomes do cabeçalho. Cada coluna é usada no máximo uma vez. */
export function autoMap(headers: string[]): Mapping {
  const normalized = headers.map((h) => normalizeSearch(h).replace(/\b(r|rs|dias|unid|und)\b/g, "").replace(/\s+/g, " ").trim());
  const rawNormalized = headers.map((h) => normalizeSearch(h));
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const field of FIELDS) {
    const syn = SYNONYMS[field];
    let idx = normalized.findIndex((h, i) => !used.has(i) && syn.includes(h));
    if (idx < 0) idx = rawNormalized.findIndex((h, i) => !used.has(i) && syn.includes(h));
    if (idx < 0) {
      // Segunda tentativa: alguma palavra do cabeçalho é uma palavra-chave do campo.
      idx = rawNormalized.findIndex((h, i) => !used.has(i) && h.split(' ').some((w) => KEYWORDS[field].includes(w)));
    }
    if (idx >= 0) {
      used.add(idx);
      mapping[field] = headers[idx];
    }
  }
  return mapping;
}

// ---------- células ----------

/** Texto limpo: sem caracteres de controle, aparado e com tamanho máximo. */
export function cellToText(v: CellValue, max: number): string {
  if (v === null || v === undefined) return "";
  const raw = typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : v;
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

/** Converte a célula de custo em centavos. `null` se vazia, não numérica ou ≤ 0. */
export function cellToCents(v: CellValue): Cents | null {
  if (v === null || v === undefined) return null;
  let cents: number;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    cents = Math.round((v + Number.EPSILON) * 100);
  } else {
    try {
      cents = parseBRL(v);
    } catch {
      return null;
    }
  }
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

// ---------- linhas ----------

export type ParsedRow = {
  rowNumber: number; // linha na planilha (o cabeçalho é a linha 1)
  codigo: string;
  fabricante?: string;
  modelo?: string;
  categoria?: string;
  descricao?: string;
  custoCentavos?: Cents;
  link?: string;
  validadeDias?: number;
  errors: string[];
  warnings: string[];
};

function validHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseRows(headers: string[], rows: CellValue[][], mapping: Mapping, defaults: Defaults): ParsedRow[] {
  const col = (field: Field): number => {
    const h = mapping[field];
    return h ? headers.indexOf(h) : -1;
  };
  const idx = Object.fromEntries(FIELDS.map((f) => [f, col(f)])) as Record<Field, number>;
  const get = (row: CellValue[], f: Field): CellValue => (idx[f] >= 0 ? (row[idx[f]] ?? null) : null);

  const seen = new Map<string, number>();
  return rows.map((row, i) => {
    const rowNumber = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const codigo = cellToText(get(row, "codigo"), 60);
    if (!codigo) errors.push("Código ausente");
    else {
      const key = codigo.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) errors.push(`Código repetido na planilha (linha ${first})`);
      else seen.set(key, rowNumber);
    }

    const custoCentavos = cellToCents(get(row, "custo")) ?? undefined;
    if (custoCentavos === undefined) errors.push("Custo ausente ou inválido");

    let link: string | undefined = cellToText(get(row, "link"), 500) || undefined;
    if (link && !validHttpUrl(link)) {
      warnings.push("Link ignorado (não é http/https)");
      link = undefined;
    }

    let validadeDias: number | undefined;
    const rawDays = get(row, "validadeDias");
    if (rawDays !== null && cellToText(rawDays, 10) !== "") {
      const n = Number(cellToText(rawDays, 10).replace(",", "."));
      if (Number.isInteger(n) && n >= 1 && n <= 365) validadeDias = n;
      else warnings.push("Validade ignorada (use de 1 a 365 dias)");
    }

    return {
      rowNumber,
      codigo,
      fabricante: cellToText(get(row, "fabricante"), 80) || defaults.fabricante?.slice(0, 80) || undefined,
      modelo: cellToText(get(row, "modelo"), 120) || undefined,
      categoria: cellToText(get(row, "categoria"), 80) || defaults.categoria?.slice(0, 80) || undefined,
      descricao: cellToText(get(row, "descricao"), 2000) || undefined,
      custoCentavos,
      link,
      validadeDias,
      errors,
      warnings,
    };
  });
}
