import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer("criado_em", { mode: "timestamp_ms" }).notNull().default(now);

export const usuarios = sqliteTable("usuarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  perfil: text("perfil", { enum: ["administrador", "vendedor"] }).notNull(),
  podeVerCusto: integer("pode_ver_custo", { mode: "boolean" }).notNull().default(false),
  ativo: integer("ativo", { mode: "boolean" }).notNull().default(true),
  totpSegredoCifrado: text("totp_segredo_cifrado"),
  totpAtivo: integer("totp_ativo", { mode: "boolean" }).notNull().default(false),
  totpUltimoPasso: integer("totp_ultimo_passo"),
  criadoEm: createdAt(),
});

/** Etapa entre a senha correta e o código 2FA: ainda não é uma sessão. */
export const mfaPendentes = sqliteTable("mfa_pendentes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  usuarioId: integer("usuario_id").notNull().references(() => usuarios.id),
  segredoPendenteCifrado: text("segredo_pendente_cifrado"),
  tentativas: integer("tentativas").notNull().default(0),
  expiraEm: integer("expira_em", { mode: "timestamp_ms" }).notNull(),
  criadoEm: createdAt(),
});

export const codigosRecuperacao = sqliteTable(
  "codigos_recuperacao",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    usuarioId: integer("usuario_id").notNull().references(() => usuarios.id),
    codigoHash: text("codigo_hash").notNull(),
    usadoEm: integer("usado_em", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("codigos_usuario_hash_idx").on(t.usuarioId, t.codigoHash)],
);

export const sessoes = sqliteTable("sessoes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  usuarioId: integer("usuario_id").notNull().references(() => usuarios.id),
  expiraEm: integer("expira_em", { mode: "timestamp_ms" }).notNull(),
  criadoEm: createdAt(),
});

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

export const clientes = sqliteTable("clientes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  razaoSocial: text("razao_social").notNull(),
  cnpj: text("cnpj"),
  contato: text("contato"),
  email: text("email"),
  telefone: text("telefone"),
  busca: text("busca").notNull(),
  criadoEm: createdAt(),
});

export const orcamentos = sqliteTable(
  "orcamentos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    numero: text("numero").notNull(),
    clienteId: integer("cliente_id").notNull().references(() => clientes.id),
    status: text("status", {
      enum: ["em_elaboracao", "enviado", "aprovado", "recusado", "expirado"],
    })
      .notNull()
      .default("em_elaboracao"),
    validoAte: integer("valido_ate", { mode: "timestamp_ms" }).notNull(),
    condicoesPagamento: text("condicoes_pagamento").notNull().default(""),
    prazoEntrega: text("prazo_entrega").notNull().default(""),
    garantia: text("garantia").notNull().default(""),
    observacoes: text("observacoes").notNull().default(""),
    freteCentavos: integer("frete_centavos").notNull().default(0),
    motivoResultado: text("motivo_resultado"),
    criadoPor: integer("criado_por").notNull().references(() => usuarios.id),
    criadoEm: createdAt(),
    enviadoEm: integer("enviado_em", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("orcamentos_numero_idx").on(t.numero)],
);

export const orcamentoItens = sqliteTable(
  "orcamento_itens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orcamentoId: integer("orcamento_id").notNull().references(() => orcamentos.id, { onDelete: "cascade" }),
    tipo: text("tipo", { enum: ["produto", "servico"] }).notNull(),
    produtoId: integer("produto_id").references(() => produtos.id),
    descricao: text("descricao").notNull(),
    quantidade: integer("quantidade").notNull(),
    custoCentavos: integer("custo_centavos").notNull().default(0),
    margemBps: integer("margem_bps").notNull().default(0),
    margemMinimaBps: integer("margem_minima_bps").notNull().default(0),
    impostosBps: integer("impostos_bps").notNull().default(0),
    precoUnitarioCentavos: integer("preco_unitario_centavos").notNull(),
    descontoBps: integer("desconto_bps").notNull().default(0),
    custoValidoAte: integer("custo_valido_ate", { mode: "timestamp_ms" }),
    ofertaCustoId: integer("oferta_custo_id").references(() => ofertasCusto.id),
  },
  (t) => [index("itens_orcamento_idx").on(t.orcamentoId)],
);

export const auditoria = sqliteTable("auditoria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  usuarioId: integer("usuario_id"),
  acao: text("acao").notNull(),
  entidade: text("entidade").notNull(),
  entidadeId: integer("entidade_id"),
  antes: text("antes"),
  depois: text("depois"),
  criadoEm: createdAt(),
});

export const sequenciaOrcamento = sqliteTable("sequencia_orcamento", {
  ano: integer("ano").primaryKey(),
  ultimo: integer("ultimo").notNull(),
});
