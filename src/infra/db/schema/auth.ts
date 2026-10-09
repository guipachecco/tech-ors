// Acesso: usuários, sessões e segundo fator (2FA).
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt } from "./_helpers";

export const usuarios = sqliteTable("usuarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  perfil: text("perfil", { enum: ["root", "administrador", "vendedor"] }).notNull(),
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
