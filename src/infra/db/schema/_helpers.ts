import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

/** Agora, em milissegundos (padrão das colunas de data). */
export const now = sql`(unixepoch() * 1000)`;
export const createdAt = () => integer("criado_em", { mode: "timestamp_ms" }).notNull().default(now);
