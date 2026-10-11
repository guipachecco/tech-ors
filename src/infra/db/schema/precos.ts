// Atualização automática de preços: de onde vem a planilha de cada fornecedor, o histórico das execuções
// e as alterações que esperam revisão (variação grande demais para entrar sozinha).
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt } from "./_helpers";
import { usuarios } from "./auth";
import { fornecedores, produtos } from "./catalog";

export const fontesPreco = sqliteTable("fontes_preco", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fornecedorId: integer("fornecedor_id").notNull().unique().references(() => fornecedores.id),
  /** Link direto da planilha (.xlsx/.csv) que o sistema baixa sozinho todo dia. Vazio = só recebe por envio. */
  urlArquivo: text("url_arquivo"),
  /** Cabeçalho de autenticação do link (ex.: "Authorization: Bearer …"), criptografado. */
  cabecalhoAuth: text("cabecalho_auth"),
  /** Chave de envio (hash). O fornecedor/automação envia a planilha para o sistema usando esta chave. */
  tokenHash: text("token_hash"),
  tokenFinal: text("token_final"),
  /** Variação de custo acima disso (em pontos-base) espera revisão em vez de entrar sozinha. */
  limiteVariacaoBps: integer("limite_variacao_bps").notNull().default(3000),
  ativo: integer("ativo", { mode: "boolean" }).notNull().default(true),
  ultimaExecucaoEm: integer("ultima_execucao_em", { mode: "timestamp_ms" }),
  ultimoSucessoEm: integer("ultimo_sucesso_em", { mode: "timestamp_ms" }),
});

export const execucoesPreco = sqliteTable(
  "execucoes_preco",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fornecedorId: integer("fornecedor_id").notNull().references(() => fornecedores.id),
    origem: text("origem", { enum: ["agendado", "envio", "manual"] }).notNull(),
    status: text("status", { enum: ["ok", "revisar", "erro"] }).notNull(),
    nomeArquivo: text("nome_arquivo"),
    mensagem: text("mensagem"),
    resumoJson: text("resumo_json"),
    iniciadaEm: createdAt(),
  },
  (t) => [index("execucoes_forn_idx").on(t.fornecedorId, t.iniciadaEm)],
);

export const alteracoesPendentes = sqliteTable(
  "alteracoes_pendentes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    execucaoId: integer("execucao_id").notNull().references(() => execucoesPreco.id, { onDelete: "cascade" }),
    fornecedorId: integer("fornecedor_id").notNull().references(() => fornecedores.id),
    produtoId: integer("produto_id").notNull().references(() => produtos.id),
    skuFornecedor: text("sku_fornecedor"),
    urlProduto: text("url_produto"),
    custoAnteriorCentavos: integer("custo_anterior_centavos").notNull(),
    custoNovoCentavos: integer("custo_novo_centavos").notNull(),
    validadeDias: integer("validade_dias"),
    estado: text("estado", { enum: ["pendente", "aplicada", "descartada"] }).notNull().default("pendente"),
    resolvidaPor: integer("resolvida_por").references(() => usuarios.id),
    resolvidaEm: integer("resolvida_em", { mode: "timestamp_ms" }),
    criadoEm: createdAt(),
  },
  (t) => [index("pendentes_estado_idx").on(t.estado, t.fornecedorId)],
);
