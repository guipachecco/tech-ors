import ExcelJS from "exceljs";
import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";
import {
  autoMap, cellToText, FIELDS, parseRows, type CellValue, type Defaults, type Field, type Mapping, type ParsedRow,
} from "../../domain/import";
import type { Cents } from "../../domain/money";
import { recordAudit } from "../audit";
import { assertCan, can } from "../auth/permissions";
import type { SessionUser } from "../auth/sessions";
import type { Db } from "../db/client";
import { fornecedores, importacoes, modelosImportacao, ofertasCusto, produtos } from "../db/schema";
import { NotFoundError } from "../validation";
import { addCostOffer } from "./offers";
import { saveProduct } from "./products";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const MAX_COLS = 40;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const IMPORT_HOURS = 24;
const DAY = 86_400_000;

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

// ---------- importação (envio + mapeamento) ----------

export type ImportRecord = typeof importacoes.$inferSelect;

function ownImport(db: Db, user: SessionUser, id: number): ImportRecord {
  assertCan(user, "cost:write");
  const rec = db.select().from(importacoes).where(eq(importacoes.id, id)).get();
  if (!rec || (rec.usuarioId !== user.id && !can(user, "user:manage"))) throw new NotFoundError("Importação");
  return rec;
}

export function getImportRecord(db: Db, user: SessionUser, id: number): ImportRecord {
  return ownImport(db, user, id);
}

export async function createImport(
  db: Db, user: SessionUser, input: { fornecedorId: number; fileName: string; buffer: Buffer }, now = new Date(),
): Promise<ImportRecord> {
  assertCan(user, "cost:write");
  const supplier = db.select().from(fornecedores).where(eq(fornecedores.id, input.fornecedorId)).get();
  if (!supplier || !supplier.ativo) throw new ImportError("Escolha um fornecedor cadastrado.");
  const sheet = await readSheet(input.buffer);

  // Modelo salvo do fornecedor (se as colunas dele ainda existirem nesta planilha); senão, sugestão automática.
  const saved = db.select().from(modelosImportacao).where(eq(modelosImportacao.fornecedorId, supplier.id)).get();
  let mapping: Mapping = autoMap(sheet.headers);
  let defaults: Defaults = {};
  if (saved) {
    const m = JSON.parse(saved.mapeamentoJson) as Mapping;
    if (Object.values(m).every((h) => h && sheet.headers.includes(h)) && Object.keys(m).length > 0) {
      mapping = m;
      defaults = JSON.parse(saved.padroesJson) as Defaults;
    }
  }

  db.delete(importacoes).where(or(lt(importacoes.expiraEm, now), and(isNotNull(importacoes.aplicadaEm), lt(importacoes.criadoEm, new Date(now.getTime() - 7 * DAY))))).run();
  const rec = db
    .insert(importacoes)
    .values({
      usuarioId: user.id,
      fornecedorId: supplier.id,
      nomeArquivo: input.fileName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120),
      cabecalhosJson: JSON.stringify(sheet.headers),
      linhasJson: JSON.stringify(sheet.rows),
      mapeamentoJson: JSON.stringify(mapping),
      padroesJson: JSON.stringify(defaults),
      expiraEm: new Date(now.getTime() + IMPORT_HOURS * 3600_000),
      criadoEm: now,
    })
    .returning()
    .get();
  recordAudit(db, { userId: user.id, acao: "importacao.enviar", entidade: "importacao", entidadeId: rec.id, depois: { fornecedor: supplier.nome, arquivo: rec.nomeArquivo, linhas: sheet.rows.length } });
  return rec;
}

export function saveImportMapping(db: Db, user: SessionUser, importId: number, input: { mapping: Mapping; defaults: Defaults }): void {
  const rec = ownImport(db, user, importId);
  if (rec.aplicadaEm) throw new ImportError("Esta importação já foi concluída.");
  const headers = JSON.parse(rec.cabecalhosJson) as string[];

  const clean: Mapping = {};
  const usedHeaders = new Set<string>();
  for (const f of FIELDS) {
    const h = input.mapping[f];
    if (!h) continue;
    if (!headers.includes(h)) throw new ImportError(`A coluna “${h}” não existe nesta planilha.`);
    if (usedHeaders.has(h)) throw new ImportError(`A coluna “${h}” foi escolhida para mais de um campo.`);
    usedHeaders.add(h);
    clean[f] = h;
  }
  const defaults: Defaults = {
    categoria: input.defaults.categoria?.trim().slice(0, 80) || undefined,
    fabricante: input.defaults.fabricante?.trim().slice(0, 80) || undefined,
  };

  db.update(importacoes).set({ mapeamentoJson: JSON.stringify(clean), padroesJson: JSON.stringify(defaults) }).where(eq(importacoes.id, importId)).run();
  if (clean.codigo && clean.custo) {
    const values = { mapeamentoJson: JSON.stringify(clean), padroesJson: JSON.stringify(defaults), atualizadoEm: new Date() };
    const existing = db.select().from(modelosImportacao).where(eq(modelosImportacao.fornecedorId, rec.fornecedorId)).get();
    if (existing) db.update(modelosImportacao).set(values).where(eq(modelosImportacao.id, existing.id)).run();
    else db.insert(modelosImportacao).values({ fornecedorId: rec.fornecedorId, ...values }).run();
  }
}

// ---------- análise ----------

export type RowStatus = "novo" | "atualiza" | "reconfirma" | "erro";

export type AnalyzedRow = {
  rowNumber: number;
  parsed: ParsedRow;
  status: RowStatus;
  produtoId?: number;
  produtoNome?: string;
  custoAnteriorCentavos?: Cents;
  /** Modelo/fabricante/categoria que serão usados se o produto for criado. */
  novoProduto?: { sku: string; fabricante: string; modelo: string; categoria: string; descricao: string };
  problemas: string[];
};

export type ImportAnalysis = {
  record: ImportRecord;
  fornecedorNome: string;
  headers: string[];
  mapping: Mapping;
  defaults: Defaults;
  sample: CellValue[][];
  missingRequired: Field[];
  rows: AnalyzedRow[];
  summary: Record<RowStatus, number>;
};

export function analyzeImport(db: Db, user: SessionUser, importId: number): ImportAnalysis {
  const rec = ownImport(db, user, importId);
  const headers = JSON.parse(rec.cabecalhosJson) as string[];
  const allRows = JSON.parse(rec.linhasJson) as CellValue[][];
  const mapping = JSON.parse(rec.mapeamentoJson ?? "{}") as Mapping;
  const defaults = JSON.parse(rec.padroesJson) as Defaults;
  const supplier = db.select().from(fornecedores).where(eq(fornecedores.id, rec.fornecedorId)).get()!;
  const summary: Record<RowStatus, number> = { novo: 0, atualiza: 0, reconfirma: 0, erro: 0 };
  const missingRequired = (["codigo", "custo"] as Field[]).filter((f) => !mapping[f]);
  const base = { record: rec, fornecedorNome: supplier.nome, headers, mapping, defaults, sample: allRows.slice(0, 3), missingRequired };
  if (missingRequired.length > 0) return { ...base, rows: [], summary };

  // Catálogo em memória (centenas de itens): código do fornecedor → produto, SKU → produto, último custo deste fornecedor.
  const products = db.select().from(produtos).all();
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  const byId = new Map(products.map((p) => [p.id, p]));
  const offers = db.select().from(ofertasCusto).where(eq(ofertasCusto.fornecedorId, rec.fornecedorId)).orderBy(desc(ofertasCusto.obtidoEm), desc(ofertasCusto.id)).all();
  const byCode = new Map<string, number>();
  const lastCost = new Map<number, Cents>();
  for (const o of offers) {
    if (o.skuFornecedor && !byCode.has(o.skuFornecedor.toLowerCase())) byCode.set(o.skuFornecedor.toLowerCase(), o.produtoId);
    if (!lastCost.has(o.produtoId)) lastCost.set(o.produtoId, o.custoCentavos);
  }

  const rows = parseRows(headers, allRows, mapping, defaults).map<AnalyzedRow>((parsed) => {
    const problemas = [...parsed.errors];
    const key = parsed.codigo.toLowerCase();
    const produtoId = key ? (byCode.get(key) ?? bySku.get(key)?.id) : undefined;
    const row: AnalyzedRow = { rowNumber: parsed.rowNumber, parsed, status: "erro", problemas };

    if (produtoId !== undefined) {
      const p = byId.get(produtoId)!;
      row.produtoId = produtoId;
      row.produtoNome = `${p.fabricante} ${p.modelo}`;
      const prev = lastCost.get(produtoId);
      if (prev !== undefined) row.custoAnteriorCentavos = prev;
      if (problemas.length === 0) row.status = prev !== undefined && prev === parsed.custoCentavos ? "reconfirma" : "atualiza";
    } else if (problemas.length === 0) {
      const fabricante = parsed.fabricante;
      const categoria = parsed.categoria;
      if (!fabricante) problemas.push("Produto novo: informe o fabricante (coluna ou valor padrão)");
      if (!categoria) problemas.push("Produto novo: informe a categoria (coluna ou valor padrão)");
      if (fabricante && categoria) {
        const modelo = (parsed.modelo ?? parsed.descricao ?? parsed.codigo).slice(0, 120);
        row.novoProduto = { sku: parsed.codigo, fabricante, modelo, categoria, descricao: parsed.descricao ?? "" };
        row.produtoNome = `${fabricante} ${modelo}`;
        row.status = "novo";
      }
    }
    summary[row.status]++;
    return row;
  });
  return { ...base, rows, summary };
}

// ---------- aplicação ----------

export type ImportResult = { novos: number; atualizados: number; reconfirmados: number; ignorados: number };

export function applyImport(db: Db, user: SessionUser, importId: number, selectedRows: number[], now = new Date()): ImportResult {
  const rec = ownImport(db, user, importId);
  if (rec.aplicadaEm) throw new ImportError("Esta importação já foi concluída.");
  if (rec.expiraEm.getTime() <= now.getTime()) throw new ImportError("A importação expirou. Envie a planilha novamente.");

  const analysis = analyzeImport(db, user, importId); // sempre reanalisa no servidor; nunca confia no que veio do navegador
  if (analysis.missingRequired.length > 0) throw new ImportError("Associe as colunas de código e de custo antes de importar.");
  const selected = new Set(selectedRows);
  const chosen = analysis.rows.filter((r) => r.status !== "erro" && selected.has(r.rowNumber));
  if (chosen.length === 0) throw new ImportError("Nenhuma linha válida foi selecionada.");

  const result: ImportResult = { novos: 0, atualizados: 0, reconfirmados: 0, ignorados: analysis.rows.length - chosen.length };
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    for (const r of chosen) {
      let produtoId = r.produtoId;
      if (r.status === "novo" && r.novoProduto) {
        produtoId = saveProduct(t, user, r.novoProduto, now).id;
        result.novos++;
      } else if (r.status === "reconfirma") result.reconfirmados++;
      else result.atualizados++;

      addCostOffer(
        t,
        user,
        {
          produtoId: produtoId!,
          fornecedorId: rec.fornecedorId,
          skuFornecedor: r.parsed.codigo,
          urlProduto: r.parsed.link,
          custoCentavos: r.parsed.custoCentavos!,
          observacao: `Importação ${rec.nomeArquivo}`.slice(0, 500),
          obtidoEm: now,
          validoAte: r.parsed.validadeDias ? new Date(now.getTime() + r.parsed.validadeDias * DAY) : undefined,
        },
        now,
      );
    }
    t.update(importacoes).set({ aplicadaEm: now, resumoJson: JSON.stringify(result) }).where(eq(importacoes.id, importId)).run();
  });
  recordAudit(db, { userId: user.id, acao: "importacao.aplicar", entidade: "importacao", entidadeId: importId, depois: { fornecedor: analysis.fornecedorNome, ...result } });
  return result;
}

export function importResult(rec: ImportRecord): ImportResult | null {
  return rec.resumoJson ? (JSON.parse(rec.resumoJson) as ImportResult) : null;
}
