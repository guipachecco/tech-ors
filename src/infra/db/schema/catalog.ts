// Catálogo: fornecedores, produtos, custos, margens, configurações, fotos e importações.
import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { now, createdAt } from "./_helpers";
import { usuarios } from "./auth";

export const fornecedores = sqliteTable("fornecedores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nome: text("nome").notNull(),
  site: text("site"),
  observacoes: text("observacoes"),
  ativo: integer("ativo", { mode: "boolean" }).notNull().default(true),
});

export const produtos = sqliteTable(
  "produtos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sku: text("sku").notNull().unique(),
    fabricante: text("fabricante").notNull(),
    modelo: text("modelo").notNull(),
    categoria: text("categoria").notNull(),
    descricao: text("descricao").notNull().default(""),
    especificacoes: text("especificacoes"),
    busca: text("busca").notNull(),
    /** Momento do último envio de foto (null = sem foto). Também serve para renovar o cache do navegador. */
    fotoVersao: integer("foto_versao"),
    ativo: integer("ativo", { mode: "boolean" }).notNull().default(true),
    criadoEm: createdAt(),
    atualizadoEm: integer("atualizado_em", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("produtos_busca_idx").on(t.busca)],
);

export const ofertasCusto = sqliteTable(
  "ofertas_custo",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    produtoId: integer("produto_id").notNull().references(() => produtos.id),
    fornecedorId: integer("fornecedor_id").notNull().references(() => fornecedores.id),
    skuFornecedor: text("sku_fornecedor"),
    urlProduto: text("url_produto"),
    custoCentavos: integer("custo_centavos").notNull(),
    observacao: text("observacao"),
    obtidoEm: integer("obtido_em", { mode: "timestamp_ms" }).notNull(),
    validoAte: integer("valido_ate", { mode: "timestamp_ms" }).notNull(),
    criadoPor: integer("criado_por").references(() => usuarios.id),
  },
  (t) => [index("ofertas_produto_idx").on(t.produtoId)],
);

export const regrasMargem = sqliteTable(
  "regras_margem",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    escopo: text("escopo", { enum: ["categoria", "fabricante"] }).notNull(),
    chave: text("chave").notNull(),
    margemBps: integer("margem_bps").notNull(),
    margemMinimaBps: integer("margem_minima_bps").notNull(),
    validadeCustoDias: integer("validade_custo_dias"),
  },
  (t) => [uniqueIndex("regras_escopo_chave_idx").on(t.escopo, t.chave)],
);

export const configuracao = sqliteTable("configuracao", {
  id: integer("id").primaryKey(),
  empresaNome: text("empresa_nome").notNull().default("Minha Empresa"),
  empresaCnpj: text("empresa_cnpj").notNull().default(""),
  empresaEndereco: text("empresa_endereco").notNull().default(""),
  empresaTelefone: text("empresa_telefone").notNull().default(""),
  empresaEmail: text("empresa_email").notNull().default(""),
  validadeCustoDiasPadrao: integer("validade_custo_dias_padrao").notNull().default(7),
  validadePropostaDias: integer("validade_proposta_dias").notNull().default(15),
  impostosBps: integer("impostos_bps").notNull().default(0),
  margemPadraoBps: integer("margem_padrao_bps").notNull().default(2000),
  margemMinimaPadraoBps: integer("margem_minima_padrao_bps").notNull().default(1000),
  condicoesPagamento: text("condicoes_pagamento").notNull().default("À vista ou a combinar"),
  prazoEntrega: text("prazo_entrega").notNull().default("A combinar"),
  garantia: text("garantia").notNull().default("Conforme fabricante"),
  observacoesPadrao: text("observacoes_padrao").notNull().default(""),
});

/** Mapeamento de colunas salvo por fornecedor: a próxima planilha dele já vem configurada. */
export const modelosImportacao = sqliteTable("modelos_importacao", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fornecedorId: integer("fornecedor_id").notNull().unique().references(() => fornecedores.id),
  mapeamentoJson: text("mapeamento_json").notNull(),
  padroesJson: text("padroes_json").notNull().default("{}"),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp_ms" }).notNull().default(now),
});

/** Planilha enviada, guardada até ser confirmada (ou expirar). Nada vai ao catálogo antes da confirmação. */
export const importacoes = sqliteTable("importacoes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  usuarioId: integer("usuario_id").notNull().references(() => usuarios.id),
  fornecedorId: integer("fornecedor_id").notNull().references(() => fornecedores.id),
  nomeArquivo: text("nome_arquivo").notNull(),
  cabecalhosJson: text("cabecalhos_json").notNull(),
  linhasJson: text("linhas_json").notNull(),
  mapeamentoJson: text("mapeamento_json"),
  padroesJson: text("padroes_json").notNull().default("{}"),
  resumoJson: text("resumo_json"),
  aplicadaEm: integer("aplicada_em", { mode: "timestamp_ms" }),
  expiraEm: integer("expira_em", { mode: "timestamp_ms" }).notNull(),
  criadoEm: createdAt(),
});

/** Foto do produto, já normalizada (JPEG, até 1000 px). Tabela à parte para não pesar nas listagens. */
export const produtoFotos = sqliteTable("produto_fotos", {
  produtoId: integer("produto_id").primaryKey().references(() => produtos.id),
  dados: blob("dados", { mode: "buffer" }).notNull(),
  atualizadoEm: integer("atualizado_em", { mode: "timestamp_ms" }).notNull().default(now),
});
