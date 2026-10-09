import type { Db } from "./db/client";
import { auditoria } from "./db/schema";

const SENSITIVE = new Set(["senhahash", "senha", "password", "token", "tokenhash"]);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE.has(k.toLowerCase()))
        .map(([k, v]) => [k, scrub(v)]),
    );
  }
  return value;
}

export type AuditEntry = {
  userId: number | null;
  acao: string;
  entidade: string;
  entidadeId?: number;
  antes?: unknown;
  depois?: unknown;
};

export function recordAudit(db: Db, e: AuditEntry): void {
  db.insert(auditoria)
    .values({
      usuarioId: e.userId,
      acao: e.acao,
      entidade: e.entidade,
      entidadeId: e.entidadeId ?? null,
      antes: e.antes === undefined ? null : JSON.stringify(scrub(e.antes)),
      depois: e.depois === undefined ? null : JSON.stringify(scrub(e.depois)),
    })
    .run();
}
