import { eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { SessionUser } from "../auth/sessions";
import type { Db } from "../db/client";
import { fornecedores } from "../db/schema";
import { NotFoundError, parseInput } from "../validation";

export type Supplier = typeof fornecedores.$inferSelect;

export const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Informe um link http:// ou https:// válido");

export const supplierSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").max(120),
  site: z.union([httpUrl, z.literal("")]).optional(),
  observacoes: z.string().trim().max(1000).optional(),
});

export function listSuppliers(db: Db): Supplier[] {
  return db.select().from(fornecedores).where(eq(fornecedores.ativo, true)).orderBy(fornecedores.nome).all();
}

export function saveSupplier(db: Db, user: SessionUser, input: z.input<typeof supplierSchema> & { id?: number }): Supplier {
  const data = parseInput(supplierSchema, input);
  const values = { nome: data.nome, site: data.site || null, observacoes: data.observacoes || null };
  if (input.id) {
    const before = db.select().from(fornecedores).where(eq(fornecedores.id, input.id)).get();
    if (!before) throw new NotFoundError("Fornecedor");
    const after = db.update(fornecedores).set(values).where(eq(fornecedores.id, input.id)).returning().get();
    recordAudit(db, { userId: user.id, acao: "fornecedor.alterar", entidade: "fornecedor", entidadeId: after.id, antes: before, depois: after });
    return after;
  }
  const created = db.insert(fornecedores).values(values).returning().get();
  recordAudit(db, { userId: user.id, acao: "fornecedor.criar", entidade: "fornecedor", entidadeId: created.id, depois: created });
  return created;
}
