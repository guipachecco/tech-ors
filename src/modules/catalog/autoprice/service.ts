import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Defaults, Mapping } from "@/domain/import";
import { defaultValidUntil } from "@/domain/costs";
import type { Cents } from "@/domain/money";
import { needsReview } from "@/domain/priceChange";
import { toDirectDownloadUrl } from "@/domain/sourceUrl";
import { recordAudit } from "@/infra/audit";
import type { Db } from "@/infra/db/client";
import { alteracoesPendentes, execucoesPreco, fontesPreco, fornecedores, modelosImportacao, ofertasCusto, produtos } from "@/infra/db/schema";
import { downloadFile, RemoteFileError } from "@/infra/remoteFile";
import { NotFoundError, parseInput, ValidationError } from "@/infra/validation";
import { assertCan } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { decryptSecret, encryptSecret } from "@/modules/auth/totp";
import { totpKey } from "@/modules/auth/totpKey";
import { insertCostOffers } from "../costs/service";
import { classifyRows, ImportError, MAX_FILE_BYTES, readSheet } from "../import";
import { loadPricingContext, resolveRuleWith } from "../margins/service";
import { httpUrl } from "../suppliers/service";

const DAY = 86_400_000;
const DEFAULT_LIMIT_BPS = 3000;
/** Se mais da metade das linhas dá erro, o layout da planilha provavelmente mudou: nada é gravado. */
const MAX_ERROR_SHARE = 0.5;

export type PriceSource = typeof fontesPreco.$inferSelect;
export type RunOrigin = "agendado" | "envio" | "manual";
export type RunStatus = "ok" | "revisar" | "erro";

export type RunSummary = {
  linhas: number;
  atualizados: number;
  reconfirmados: number;
  aguardandoRevisao: number;
  naoCadastrados: number;
  erros: number;
  codigosNaoCadastrados: string[];
  amostraErros: { linha: number; motivo: string }[];
};

export type RunResult = { execucaoId: number; status: RunStatus; mensagem: string; resumo?: RunSummary };

// ---------- configuração da fonte ----------

async function getOrCreateSource(db: Db, supplierId: number): Promise<PriceSource> {
  const existing = await db.select().from(fontesPreco).where(eq(fontesPreco.fornecedorId, supplierId)).get();
  if (existing) return existing;
  const supplier = await db.select({ id: fornecedores.id }).from(fornecedores).where(eq(fornecedores.id, supplierId)).get();
  if (!supplier) throw new NotFoundError("Fornecedor");
  await db.insert(fontesPreco).values({ fornecedorId: supplierId }).onConflictDoNothing().run();
  return (await db.select().from(fontesPreco).where(eq(fontesPreco.fornecedorId, supplierId)).get())!;
}

export async function getSource(db: Db, supplierId: number): Promise<PriceSource | null> {
  return (await db.select().from(fontesPreco).where(eq(fontesPreco.fornecedorId, supplierId)).get()) ?? null;
}

export async function listSources(db: Db): Promise<PriceSource[]> {
  return await db.select().from(fontesPreco).all();
}

export const sourceSchema = z.object({
  fornecedorId: z.number().int().positive(),
  urlArquivo: z.union([httpUrl, z.literal("")]).optional(),
  /** `undefined` mantém o que está salvo; `""` remove. Formato: "Nome-do-cabeçalho: valor". */
  cabecalhoAuth: z.string().trim().max(600).optional(),
  limiteVariacaoBps: z.number().int().min(100, "Mínimo 1%").max(10_000, "Máximo 100%"),
  ativo: z.boolean(),
});

const HEADER_LINE = /^([A-Za-z0-9-]{1,60}):\s*(\S.{0,500})$/;

export async function saveSource(db: Db, user: SessionUser, input: z.input<typeof sourceSchema>): Promise<PriceSource> {
  assertCan(user, "settings:manage");
  const data = parseInput(sourceSchema, input);
  const before = await getOrCreateSource(db, data.fornecedorId);

  const url = data.urlArquivo ? toDirectDownloadUrl(data.urlArquivo) : null;
  if (url && !url.startsWith("https://")) throw new ValidationError({ urlArquivo: "O link precisa começar com https://" });

  let cabecalho = before.cabecalhoAuth;
  if (data.cabecalhoAuth !== undefined) {
    if (data.cabecalhoAuth === "") cabecalho = null;
    else if (!HEADER_LINE.test(data.cabecalhoAuth)) throw new ValidationError({ cabecalhoAuth: "Use o formato Nome: valor (ex.: Authorization: Bearer abc123)" });
    else cabecalho = encryptSecret(data.cabecalhoAuth, totpKey());
  }
  if (!url) cabecalho = null;

  const after = await db
    .update(fontesPreco)
    .set({ urlArquivo: url, cabecalhoAuth: cabecalho, limiteVariacaoBps: data.limiteVariacaoBps, ativo: data.ativo })
    .where(eq(fontesPreco.id, before.id))
    .returning()
    .get();
  await recordAudit(db, {
    userId: user.id, acao: "fonte_preco.salvar", entidade: "fornecedor", entidadeId: data.fornecedorId,
    antes: { url: before.urlArquivo, limite: before.limiteVariacaoBps, ativo: before.ativo },
    depois: { url: after.urlArquivo, limite: after.limiteVariacaoBps, ativo: after.ativo, comAutenticacao: !!after.cabecalhoAuth },
  });
  return after;
}

// ---------- chave de envio ----------

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Gera uma chave nova (a anterior deixa de valer). O texto da chave só é mostrado agora; no banco fica só o hash. */
export async function createPushToken(db: Db, user: SessionUser, supplierId: number): Promise<string> {
  assertCan(user, "settings:manage");
  const source = await getOrCreateSource(db, supplierId);
  const token = `tm_${randomBytes(32).toString("base64url")}`;
  await db.update(fontesPreco).set({ tokenHash: hashToken(token), tokenFinal: token.slice(-4) }).where(eq(fontesPreco.id, source.id)).run();
  await recordAudit(db, { userId: user.id, acao: "fonte_preco.chave_gerar", entidade: "fornecedor", entidadeId: supplierId });
  return token;
}

export async function revokePushToken(db: Db, user: SessionUser, supplierId: number): Promise<void> {
  assertCan(user, "settings:manage");
  const source = await getSource(db, supplierId);
  if (!source) return;
  await db.update(fontesPreco).set({ tokenHash: null, tokenFinal: null }).where(eq(fontesPreco.id, source.id)).run();
  await recordAudit(db, { userId: user.id, acao: "fonte_preco.chave_revogar", entidade: "fornecedor", entidadeId: supplierId });
}

/** Confere a chave enviada com a do fornecedor (comparação de tempo constante). */
export async function verifyPushToken(db: Db, supplierId: number, token: string): Promise<boolean> {
  const source = await getSource(db, supplierId);
  if (!source?.tokenHash || !source.ativo || !token) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(source.tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- execução ----------

type RunInfo = { nomeArquivo?: string; mensagem: string; resumo?: RunSummary };

async function recordRun(db: Db, supplierId: number, origem: RunOrigin, status: RunStatus, info: RunInfo, now: Date): Promise<RunResult> {
  const run = await db
    .insert(execucoesPreco)
    .values({
      fornecedorId: supplierId, origem, status, nomeArquivo: info.nomeArquivo?.slice(0, 120) ?? null,
      mensagem: info.mensagem.slice(0, 500), resumoJson: info.resumo ? JSON.stringify(info.resumo) : null, iniciadaEm: now,
    })
    .returning()
    .get();
  const source = await getOrCreateSource(db, supplierId);
  await db
    .update(fontesPreco)
    .set({ ultimaExecucaoEm: now, ...(status === "erro" ? {} : { ultimoSucessoEm: now }) })
    .where(eq(fontesPreco.id, source.id))
    .run();
  return { execucaoId: run.id, status, mensagem: info.mensagem, resumo: info.resumo };
}

function summaryText(r: RunSummary): string {
  const parts = [`${r.atualizados} preço(s) atualizado(s)`, `${r.reconfirmados} confirmado(s)`];
  if (r.aguardandoRevisao) parts.push(`${r.aguardandoRevisao} aguardando revisão`);
  if (r.naoCadastrados) parts.push(`${r.naoCadastrados} código(s) não cadastrado(s)`);
  if (r.erros) parts.push(`${r.erros} linha(s) com erro`);
  return parts.join(" · ");
}

/**
 * Aplica uma planilha do fornecedor ao catálogo sem intervenção:
 *  - usa as colunas já salvas para o fornecedor (nunca adivinha);
 *  - preço igual só renova a validade; preço diferente vira nova oferta (histórico preservado);
 *  - variação acima do limite NÃO entra: fica em "alterações pendentes" para uma pessoa aprovar;
 *  - produto desconhecido não é cadastrado sozinho; só é contado;
 *  - se a planilha parece quebrada (muitos erros), não grava nada.
 * Nunca lança por problema do arquivo: o resultado (inclusive erro) fica registrado no histórico.
 */
export async function updateFromFile(
  db: Db, supplierId: number, input: { buffer: Buffer; fileName: string; origem: RunOrigin }, now = new Date(),
): Promise<RunResult> {
  const supplier = await db.select().from(fornecedores).where(eq(fornecedores.id, supplierId)).get();
  if (!supplier || !supplier.ativo) throw new NotFoundError("Fornecedor");
  const source = await getOrCreateSource(db, supplierId);
  const { origem, fileName } = input;
  const fail = (mensagem: string) => recordRun(db, supplierId, origem, "erro", { nomeArquivo: fileName, mensagem }, now);

  let sheet;
  try {
    sheet = await readSheet(input.buffer);
  } catch (e) {
    if (e instanceof ImportError) return await fail(e.message);
    throw e;
  }

  const saved = await db.select().from(modelosImportacao).where(eq(modelosImportacao.fornecedorId, supplierId)).get();
  const mapping = saved ? (JSON.parse(saved.mapeamentoJson) as Mapping) : null;
  if (!mapping?.codigo || !mapping.custo) {
    return await fail("As colunas deste fornecedor ainda não foram configuradas. Faça uma importação manual uma vez (Produtos → Importar planilha): o sistema memoriza as colunas.");
  }
  const missing = Object.values(mapping).filter((h): h is string => !!h && !sheet.headers.includes(h));
  if (missing.length > 0) {
    return await fail(`As colunas da planilha mudaram (não encontrei: ${missing.join(", ")}). Refaça o mapeamento em Produtos → Importar planilha.`);
  }
  const defaults = JSON.parse(saved!.padroesJson) as Defaults;

  const { rows, products } = await classifyRows(db, supplierId, sheet.headers, sheet.rows, mapping, defaults);
  const hardErrors = rows.filter((r) => r.parsed.errors.length > 0);
  if (hardErrors.length / rows.length > MAX_ERROR_SHARE) {
    return await fail(`${hardErrors.length} de ${rows.length} linhas com erro (ex.: ${hardErrors[0].parsed.errors[0]}). O formato da planilha pode ter mudado; nada foi alterado.`);
  }

  const resumo: RunSummary = {
    linhas: rows.length, atualizados: 0, reconfirmados: 0, aguardandoRevisao: 0, naoCadastrados: 0, erros: hardErrors.length,
    codigosNaoCadastrados: [],
    amostraErros: hardErrors.slice(0, 10).map((r) => ({ linha: r.rowNumber, motivo: r.parsed.errors[0] })),
  };

  const ctx = await loadPricingContext(db);
  const toAdd: Parameters<typeof insertCostOffers>[2] = [];
  const toRenew = new Map<number, number[]>(); // validoAte (ms) → ids das ofertas
  const held: { produtoId: number; codigo: string; link?: string; anterior: Cents; novo: Cents; validadeDias?: number }[] = [];
  const touched: number[] = [];

  for (const r of rows) {
    if (r.parsed.errors.length > 0) continue;
    if (r.produtoId === undefined) {
      resumo.naoCadastrados++;
      if (resumo.codigosNaoCadastrados.length < 20) resumo.codigosNaoCadastrados.push(r.parsed.codigo);
      continue;
    }
    touched.push(r.produtoId);
    const novo = r.parsed.custoCentavos!;
    const validoAte = r.parsed.validadeDias
      ? new Date(now.getTime() + r.parsed.validadeDias * DAY)
      : defaultValidUntil(now, resolveRuleWith(ctx, products.get(r.produtoId)!).validadeCustoDias);

    if (r.status === "reconfirma" && r.ofertaAnteriorId !== undefined) {
      resumo.reconfirmados++;
      const key = validoAte.getTime();
      toRenew.set(key, [...(toRenew.get(key) ?? []), r.ofertaAnteriorId]);
    } else if (r.custoAnteriorCentavos !== undefined && needsReview(r.custoAnteriorCentavos, novo, source.limiteVariacaoBps)) {
      resumo.aguardandoRevisao++;
      held.push({ produtoId: r.produtoId, codigo: r.parsed.codigo, link: r.parsed.link, anterior: r.custoAnteriorCentavos, novo, validadeDias: r.parsed.validadeDias });
    } else {
      resumo.atualizados++;
      toAdd.push({
        produtoId: r.produtoId, fornecedorId: supplierId, skuFornecedor: r.parsed.codigo, urlProduto: r.parsed.link,
        custoCentavos: novo, observacao: `Atualização automática (${origem})`, obtidoEm: now, validoAte,
      });
    }
  }

  const status: RunStatus = resumo.aguardandoRevisao > 0 ? "revisar" : "ok";
  const run = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await insertCostOffers(t, null, toAdd, now, { auditEach: false });
    for (const [validoAte, ids] of toRenew) {
      for (let i = 0; i < ids.length; i += 400) {
        await t.update(ofertasCusto).set({ obtidoEm: now, validoAte: new Date(validoAte) }).where(inArray(ofertasCusto.id, ids.slice(i, i + 400))).run();
      }
    }
    const result = await recordRun(t, supplierId, origem, status, { nomeArquivo: fileName, mensagem: summaryText(resumo), resumo }, now);
    // Qualquer pendência antiga destes produtos perde o sentido: o arquivo novo é a informação mais recente.
    for (let i = 0; i < touched.length; i += 400) {
      await t
        .delete(alteracoesPendentes)
        .where(and(eq(alteracoesPendentes.fornecedorId, supplierId), eq(alteracoesPendentes.estado, "pendente"), inArray(alteracoesPendentes.produtoId, touched.slice(i, i + 400))))
        .run();
    }
    for (let i = 0; i < held.length; i += 100) {
      await t
        .insert(alteracoesPendentes)
        .values(held.slice(i, i + 100).map((h) => ({
          execucaoId: result.execucaoId, fornecedorId: supplierId, produtoId: h.produtoId, skuFornecedor: h.codigo,
          urlProduto: h.link ?? null, custoAnteriorCentavos: h.anterior, custoNovoCentavos: h.novo, validadeDias: h.validadeDias ?? null,
        })))
        .run();
    }
    return result;
  });
  await recordAudit(db, { userId: null, acao: "precos.atualizacao_automatica", entidade: "fornecedor", entidadeId: supplierId, depois: { origem, arquivo: fileName, ...resumo, codigosNaoCadastrados: undefined, amostraErros: undefined } });
  return run;
}

/** Baixa a planilha do link do fornecedor e aplica. Falhas de rede também ficam registradas como execução com erro. */
export async function updateFromSource(db: Db, supplierId: number, origem: RunOrigin, now = new Date()): Promise<RunResult> {
  const source = await getSource(db, supplierId);
  if (!source?.urlArquivo) throw new ValidationError({ _: "Este fornecedor não tem link de planilha configurado." });
  let headers: Record<string, string> | undefined;
  if (source.cabecalhoAuth) {
    const line = decryptSecret(source.cabecalhoAuth, totpKey());
    const sep = line.indexOf(":");
    headers = { [line.slice(0, sep).trim()]: line.slice(sep + 1).trim() };
  }
  let file;
  try {
    file = await downloadFile(source.urlArquivo, { headers, maxBytes: MAX_FILE_BYTES });
  } catch (e) {
    if (e instanceof RemoteFileError) return await recordRun(db, supplierId, origem, "erro", { mensagem: e.message }, now);
    throw e;
  }
  return await updateFromFile(db, supplierId, { buffer: file.buffer, fileName: file.fileName, origem }, now);
}

export type BatchResult = { fornecedorId: number; nome: string; resultado: RunResult | { erro: string } }[];

/** Rotina agendada: atualiza todos os fornecedores com link ativo, do mais antigo para o mais recente, dentro de um tempo máximo. */
export async function updateAllSources(db: Db, now = new Date(), budgetMs = 50_000): Promise<BatchResult> {
  const rows = await db
    .select({ source: fontesPreco, nome: fornecedores.nome })
    .from(fontesPreco)
    .innerJoin(fornecedores, eq(fornecedores.id, fontesPreco.fornecedorId))
    .where(and(eq(fontesPreco.ativo, true), eq(fornecedores.ativo, true)))
    .all();
  const due = rows.filter((r) => r.source.urlArquivo).sort((a, b) => (a.source.ultimaExecucaoEm?.getTime() ?? 0) - (b.source.ultimaExecucaoEm?.getTime() ?? 0));
  const started = Date.now();
  const out: BatchResult = [];
  for (const r of due) {
    if (Date.now() - started > budgetMs) break;
    try {
      out.push({ fornecedorId: r.source.fornecedorId, nome: r.nome, resultado: await updateFromSource(db, r.source.fornecedorId, "agendado", now) });
    } catch (e) {
      console.error("Falha ao atualizar fornecedor", r.source.fornecedorId, e);
      out.push({ fornecedorId: r.source.fornecedorId, nome: r.nome, resultado: { erro: "Erro inesperado" } });
    }
  }
  return out;
}

// ---------- histórico e revisão ----------

export type RunRow = typeof execucoesPreco.$inferSelect & { fornecedorNome: string };

export async function listRuns(db: Db, user: SessionUser, limit = 30): Promise<RunRow[]> {
  assertCan(user, "cost:write");
  return await db
    .select({ ...getTableColumns(execucoesPreco), fornecedorNome: fornecedores.nome })
    .from(execucoesPreco)
    .innerJoin(fornecedores, eq(fornecedores.id, execucoesPreco.fornecedorId))
    .orderBy(desc(execucoesPreco.id))
    .limit(limit)
    .all();
}

export type PendingRow = {
  id: number;
  fornecedorId: number;
  fornecedorNome: string;
  produtoId: number;
  produtoNome: string;
  skuFornecedor: string | null;
  anteriorCentavos: Cents;
  novoCentavos: Cents;
  criadoEm: Date;
};

export async function listPendingChanges(db: Db, user: SessionUser): Promise<PendingRow[]> {
  assertCan(user, "cost:write");
  const rows = await db
    .select({
      id: alteracoesPendentes.id,
      fornecedorId: alteracoesPendentes.fornecedorId,
      fornecedorNome: fornecedores.nome,
      produtoId: alteracoesPendentes.produtoId,
      fabricante: produtos.fabricante,
      modelo: produtos.modelo,
      skuFornecedor: alteracoesPendentes.skuFornecedor,
      anteriorCentavos: alteracoesPendentes.custoAnteriorCentavos,
      novoCentavos: alteracoesPendentes.custoNovoCentavos,
      criadoEm: alteracoesPendentes.criadoEm,
    })
    .from(alteracoesPendentes)
    .innerJoin(fornecedores, eq(fornecedores.id, alteracoesPendentes.fornecedorId))
    .innerJoin(produtos, eq(produtos.id, alteracoesPendentes.produtoId))
    .where(eq(alteracoesPendentes.estado, "pendente"))
    .orderBy(fornecedores.nome, produtos.modelo)
    .all();
  return rows.map(({ fabricante, modelo, ...r }) => ({ ...r, produtoNome: `${fabricante} ${modelo}` }));
}

export async function countPendingChanges(db: Db): Promise<number> {
  const rows = await db.select({ id: alteracoesPendentes.id }).from(alteracoesPendentes).where(eq(alteracoesPendentes.estado, "pendente")).all();
  return rows.length;
}

/** Aprova (grava o custo novo) ou descarta alterações que ficaram esperando revisão. */
export async function resolvePendingChanges(
  db: Db, user: SessionUser, ids: number[], decision: "aplicar" | "descartar", now = new Date(),
): Promise<{ aplicadas: number; descartadas: number }> {
  assertCan(user, "cost:write");
  if (ids.length === 0) throw new ValidationError({ _: "Selecione ao menos uma alteração." });
  const pending = await db
    .select()
    .from(alteracoesPendentes)
    .where(and(inArray(alteracoesPendentes.id, ids), eq(alteracoesPendentes.estado, "pendente")))
    .all();
  if (pending.length === 0) throw new NotFoundError("Alteração pendente");

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (decision === "aplicar") {
      await insertCostOffers(
        t,
        user.id,
        pending.map((p) => ({
          produtoId: p.produtoId, fornecedorId: p.fornecedorId, skuFornecedor: p.skuFornecedor ?? undefined, urlProduto: p.urlProduto ?? undefined,
          custoCentavos: p.custoNovoCentavos, observacao: "Variação grande aprovada manualmente", obtidoEm: now,
          validoAte: p.validadeDias ? new Date(now.getTime() + p.validadeDias * DAY) : undefined,
        })),
        now,
      );
    }
    await t
      .update(alteracoesPendentes)
      .set({ estado: decision === "aplicar" ? "aplicada" : "descartada", resolvidaPor: user.id, resolvidaEm: now })
      .where(inArray(alteracoesPendentes.id, pending.map((p) => p.id)))
      .run();
  });
  await recordAudit(db, { userId: user.id, acao: `precos.pendencia_${decision === "aplicar" ? "aplicar" : "descartar"}`, entidade: "alteracao_pendente", depois: { ids: pending.map((p) => p.id) } });
  return decision === "aplicar" ? { aplicadas: pending.length, descartadas: 0 } : { aplicadas: 0, descartadas: pending.length };
}

export function parseRunSummary(run: { resumoJson: string | null }): RunSummary | null {
  return run.resumoJson ? (JSON.parse(run.resumoJson) as RunSummary) : null;
}
