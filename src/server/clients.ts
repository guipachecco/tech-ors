import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { isValidCnpj, onlyDigits } from "../domain/cnpj";
import { normalizeSearch, searchTokens } from "../domain/search";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth/sessions";
import type { Db } from "./db/client";
import { clientes } from "./db/schema";
import { NotFoundError, parseInput } from "./validation";

export type Client = typeof clientes.$inferSelect;

export const clientSchema = z.object({
  razaoSocial: z.string().trim().min(1, "Informe a razão social").max(160),
  cnpj: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidCnpj(v), "CNPJ inválido"),
  contato: z.string().trim().max(120).optional(),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido"),
  telefone: z.string().trim().max(40).optional(),
});

export function saveClient(db: Db, user: SessionUser, input: z.input<typeof clientSchema> & { id?: number }): Client {
  const data = parseInput(clientSchema, input);
  const values = {
    razaoSocial: data.razaoSocial,
    cnpj: data.cnpj ? onlyDigits(data.cnpj) : null,
    contato: data.contato || null,
    email: data.email || null,
    telefone: data.telefone || null,
    busca: normalizeSearch([data.razaoSocial, data.cnpj ?? "", data.contato ?? ""].join(" ")),
  };
  if (input.id) {
    const before = db.select().from(clientes).where(eq(clientes.id, input.id)).get();
    if (!before) throw new NotFoundError("Cliente");
    const after = db.update(clientes).set(values).where(eq(clientes.id, input.id)).returning().get();
    recordAudit(db, { userId: user.id, acao: "cliente.alterar", entidade: "cliente", entidadeId: after.id, antes: before, depois: after });
    return after;
  }
  const created = db.insert(clientes).values(values).returning().get();
  recordAudit(db, { userId: user.id, acao: "cliente.criar", entidade: "cliente", entidadeId: created.id, depois: created });
  return created;
}

export function searchClients(db: Db, query: string, limit = 50): Client[] {
  const conditions = searchTokens(query).map((t) => like(clientes.busca, `%${t}%`));
  return db.select().from(clientes).where(and(...conditions)).orderBy(clientes.razaoSocial).limit(limit).all();
}

export function getClient(db: Db, id: number): Client {
  const c = db.select().from(clientes).where(eq(clientes.id, id)).get();
  if (!c) throw new NotFoundError("Cliente");
  return c;
}
