// Clientes.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt } from "./_helpers";

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
