// Orçamentos, itens (com custo/margem/preço congelados) e numeração.
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt } from "./_helpers";
import { usuarios } from "./auth";
import { produtos, ofertasCusto } from "./catalog";
import { clientes } from "./clients";

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
    /** Aprovação interna antes do envio: nenhuma → pendente (alguém precisa revisar) → aprovada. */
    aprovacaoStatus: text("aprovacao_status", { enum: ["nenhuma", "pendente", "aprovada"] }).notNull().default("nenhuma"),
    aprovacaoPedidaPor: integer("aprovacao_pedida_por").references(() => usuarios.id),
    aprovacaoPedidaEm: integer("aprovacao_pedida_em", { mode: "timestamp_ms" }),
    aprovadoPor: integer("aprovado_por").references(() => usuarios.id),
    aprovadoEm: integer("aprovado_em", { mode: "timestamp_ms" }),
    /** Recado de quem revisou (obrigatório ao devolver). */
    aprovacaoNota: text("aprovacao_nota"),
    /** Preços que mudaram na atualização feita ao pedir a aprovação (para o revisor ver o que mudou). */
    aprovacaoMudancasJson: text("aprovacao_mudancas_json"),
    /** Código secreto do link que o cliente usa para ver e responder o orçamento. */
    tokenPublico: text("token_publico"),
    /** Resposta do cliente pelo link: nome de quem respondeu e quando. */
    respondidoPorNome: text("respondido_por_nome"),
    respondidoEm: integer("respondido_em", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("orcamentos_numero_idx").on(t.numero), uniqueIndex("orcamentos_token_idx").on(t.tokenPublico)],
);

export const orcamentoItens = sqliteTable(
  "orcamento_itens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orcamentoId: integer("orcamento_id").notNull().references(() => orcamentos.id, { onDelete: "cascade" }),
    tipo: text("tipo", { enum: ["produto", "servico"] }).notNull(),
    produtoId: integer("produto_id").references(() => produtos.id),
    descricao: text("descricao").notNull(),
    /** Especificações (texto menor sob o título do item). */
    detalhes: text("detalhes").notNull().default(""),
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

export const sequenciaOrcamento = sqliteTable("sequencia_orcamento", {
  ano: integer("ano").primaryKey(),
  ultimo: integer("ultimo").notNull(),
});
