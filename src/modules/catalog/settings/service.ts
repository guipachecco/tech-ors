import { eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/infra/audit";
import { assertCan } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import type { Db } from "@/infra/db/client";
import { configuracao } from "@/infra/db/schema";
import { parseInput, ValidationError } from "@/infra/validation";

export type Settings = typeof configuracao.$inferSelect;

export function getSettings(db: Db): Settings {
  db.insert(configuracao).values({ id: 1 }).onConflictDoNothing().run();
  return db.select().from(configuracao).where(eq(configuracao.id, 1)).get()!;
}

const text = (max: number) => z.string().trim().max(max);

export const settingsSchema = z.object({
  empresaNome: text(120).min(1, "Informe o nome da empresa"),
  empresaCnpj: text(30),
  empresaEndereco: text(250),
  empresaTelefone: text(40),
  empresaEmail: text(120),
  validadeCustoDiasPadrao: z.number().int().min(1, "Mínimo 1 dia").max(365),
  validadePropostaDias: z.number().int().min(1, "Mínimo 1 dia").max(365),
  impostosBps: z.number().int().min(0).max(3000, "Impostos acima de 30% não são aceitos"),
  margemPadraoBps: z.number().int().min(0).max(8000),
  margemMinimaPadraoBps: z.number().int().min(0).max(8000),
  condicoesPagamento: text(500),
  prazoEntrega: text(500),
  garantia: text(500),
  observacoesPadrao: text(2000),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export function saveSettings(db: Db, user: SessionUser, input: SettingsInput): Settings {
  assertCan(user, "settings:manage");
  const data = parseInput(settingsSchema, input);
  if (data.margemMinimaPadraoBps > data.margemPadraoBps) {
    throw new ValidationError({ margemMinimaPadraoBps: "A margem mínima não pode ser maior que a margem padrão" });
  }
  const before = getSettings(db);
  db.update(configuracao).set(data).where(eq(configuracao.id, 1)).run();
  const after = getSettings(db);
  recordAudit(db, { userId: user.id, acao: "configuracao.alterar", entidade: "configuracao", entidadeId: 1, antes: before, depois: after });
  return after;
}
