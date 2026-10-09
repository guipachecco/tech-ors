// Trilha de auditoria.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt } from "./_helpers";

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
