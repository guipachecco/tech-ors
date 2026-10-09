import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Bps } from "../../../domain/money";
import { recordAudit } from "../../../infra/audit";
import { assertCan } from "../../auth/permissions";
import type { SessionUser } from "../../auth/sessions";
import type { Db } from "../../../infra/db/client";
import { regrasMargem } from "../../../infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "../../../infra/validation";
import { getSettings } from "../settings/service";

export type MarginRule = typeof regrasMargem.$inferSelect;
export type ResolvedRule = { margemBps: Bps; margemMinimaBps: Bps; validadeCustoDias: number };

const key = (s: string) => s.trim().toLowerCase();

export function listMarginRules(db: Db, user: SessionUser): MarginRule[] {
  assertCan(user, "margin:manage");
  return db.select().from(regrasMargem).orderBy(regrasMargem.escopo, regrasMargem.chave).all();
}

export const marginRuleSchema = z.object({
  escopo: z.enum(["categoria", "fabricante"]),
  chave: z.string().trim().min(1, "Informe a categoria ou o fabricante").max(80),
  margemBps: z.number().int().min(0).max(8000, "Margem acima de 80% não é aceita"),
  margemMinimaBps: z.number().int().min(0).max(8000),
  validadeCustoDias: z.number().int().min(1).max(365).nullable().optional(),
});

export function saveMarginRule(db: Db, user: SessionUser, input: z.input<typeof marginRuleSchema>): MarginRule {
  assertCan(user, "margin:manage");
  const data = parseInput(marginRuleSchema, input);
  if (data.margemMinimaBps > data.margemBps) {
    throw new ValidationError({ margemMinimaBps: "A margem mínima não pode ser maior que a margem" });
  }
  const values = { ...data, validadeCustoDias: data.validadeCustoDias ?? null };
  const existing = db
    .select()
    .from(regrasMargem)
    .where(and(eq(regrasMargem.escopo, data.escopo), eq(regrasMargem.chave, data.chave)))
    .get();
  let saved: MarginRule;
  if (existing) {
    saved = db.update(regrasMargem).set(values).where(eq(regrasMargem.id, existing.id)).returning().get();
  } else {
    saved = db.insert(regrasMargem).values(values).returning().get();
  }
  recordAudit(db, { userId: user.id, acao: "regra_margem.salvar", entidade: "regra_margem", entidadeId: saved.id, antes: existing, depois: saved });
  return saved;
}

export function deleteMarginRule(db: Db, user: SessionUser, id: number): void {
  assertCan(user, "margin:manage");
  const existing = db.select().from(regrasMargem).where(eq(regrasMargem.id, id)).get();
  if (!existing) throw new NotFoundError("Regra");
  db.delete(regrasMargem).where(eq(regrasMargem.id, id)).run();
  recordAudit(db, { userId: user.id, acao: "regra_margem.excluir", entidade: "regra_margem", entidadeId: id, antes: existing });
}

/** Fabricante vence categoria; sem regra usa o padrão da configuração. */
export function resolveRule(db: Db, product: { fabricante: string; categoria: string }): ResolvedRule {
  const settings = getSettings(db);
  const rules = db.select().from(regrasMargem).all();
  const byMaker = rules.find((r) => r.escopo === "fabricante" && key(r.chave) === key(product.fabricante));
  const byCat = rules.find((r) => r.escopo === "categoria" && key(r.chave) === key(product.categoria));
  const main = byMaker ?? byCat;
  return {
    margemBps: main?.margemBps ?? settings.margemPadraoBps,
    margemMinimaBps: main?.margemMinimaBps ?? settings.margemMinimaPadraoBps,
    validadeCustoDias: byMaker?.validadeCustoDias ?? byCat?.validadeCustoDias ?? settings.validadeCustoDiasPadrao,
  };
}
