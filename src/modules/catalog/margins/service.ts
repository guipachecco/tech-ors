import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Bps } from "@/domain/money";
import { recordAudit } from "@/infra/audit";
import { assertCan } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import type { Db } from "@/infra/db/client";
import { regrasMargem } from "@/infra/db/schema";
import { NotFoundError, parseInput, ValidationError } from "@/infra/validation";
import { getSettings } from "../settings/service";

export type MarginRule = typeof regrasMargem.$inferSelect;
export type ResolvedRule = { margemBps: Bps; margemMinimaBps: Bps; validadeCustoDias: number };

const key = (s: string) => s.trim().toLowerCase();

export async function listMarginRules(db: Db, user: SessionUser): Promise<MarginRule[]> {
  assertCan(user, "margin:manage");
  return await db.select().from(regrasMargem).orderBy(regrasMargem.escopo, regrasMargem.chave).all();
}

export const marginRuleSchema = z.object({
  escopo: z.enum(["categoria", "fabricante"]),
  chave: z.string().trim().min(1, "Informe a categoria ou o fabricante").max(80),
  margemBps: z.number().int().min(0).max(8000, "Margem acima de 80% não é aceita"),
  margemMinimaBps: z.number().int().min(0).max(8000),
  validadeCustoDias: z.number().int().min(1).max(365).nullable().optional(),
});

export async function saveMarginRule(db: Db, user: SessionUser, input: z.input<typeof marginRuleSchema>): Promise<MarginRule> {
  assertCan(user, "margin:manage");
  const data = parseInput(marginRuleSchema, input);
  if (data.margemMinimaBps > data.margemBps) {
    throw new ValidationError({ margemMinimaBps: "A margem mínima não pode ser maior que a margem" });
  }
  const values = { ...data, validadeCustoDias: data.validadeCustoDias ?? null };
  const existing = await db
    .select()
    .from(regrasMargem)
    .where(and(eq(regrasMargem.escopo, data.escopo), eq(regrasMargem.chave, data.chave)))
    .get();
  let saved: MarginRule;
  if (existing) {
    saved = await db.update(regrasMargem).set(values).where(eq(regrasMargem.id, existing.id)).returning().get();
  } else {
    saved = await db.insert(regrasMargem).values(values).returning().get();
  }
  await recordAudit(db, { userId: user.id, acao: "regra_margem.salvar", entidade: "regra_margem", entidadeId: saved.id, antes: existing, depois: saved });
  return saved;
}

export async function deleteMarginRule(db: Db, user: SessionUser, id: number): Promise<void> {
  assertCan(user, "margin:manage");
  const existing = await db.select().from(regrasMargem).where(eq(regrasMargem.id, id)).get();
  if (!existing) throw new NotFoundError("Regra");
  await db.delete(regrasMargem).where(eq(regrasMargem.id, id)).run();
  await recordAudit(db, { userId: user.id, acao: "regra_margem.excluir", entidade: "regra_margem", entidadeId: id, antes: existing });
}

/** Configurações + regras de margem, lidas uma vez para precificar vários produtos sem repetir consultas. */
export type PricingContext = { settings: Awaited<ReturnType<typeof getSettings>>; rules: MarginRule[] };

export async function loadPricingContext(db: Db): Promise<PricingContext> {
  const [settings, rules] = await Promise.all([getSettings(db), db.select().from(regrasMargem).all()]);
  return { settings, rules };
}

/** Fabricante vence categoria; sem regra usa o padrão da configuração. (Função pura: não consulta o banco.) */
export function resolveRuleWith(ctx: PricingContext, product: { fabricante: string; categoria: string }): ResolvedRule {
  const byMaker = ctx.rules.find((r) => r.escopo === "fabricante" && key(r.chave) === key(product.fabricante));
  const byCat = ctx.rules.find((r) => r.escopo === "categoria" && key(r.chave) === key(product.categoria));
  const main = byMaker ?? byCat;
  return {
    margemBps: main?.margemBps ?? ctx.settings.margemPadraoBps,
    margemMinimaBps: main?.margemMinimaBps ?? ctx.settings.margemMinimaPadraoBps,
    validadeCustoDias: byMaker?.validadeCustoDias ?? byCat?.validadeCustoDias ?? ctx.settings.validadeCustoDiasPadrao,
  };
}

export async function resolveRule(db: Db, product: { fabricante: string; categoria: string }): Promise<ResolvedRule> {
  return resolveRuleWith(await loadPricingContext(db), product);
}
