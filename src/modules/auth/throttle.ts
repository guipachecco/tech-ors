import { eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client";
import { limitesTentativa } from "@/infra/db/schema";

// 5 falhas dentro de 15 min bloqueiam a chave por 15 min. A contagem é feita numa única instrução SQL
// (atômica): requisições simultâneas não conseguem "furar" o limite.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const BLOCK_MS = 15 * 60_000;

export async function checkLoginAllowed(db: Db, key: string, now = new Date()): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const row = await db.select().from(limitesTentativa).where(eq(limitesTentativa.chave, key)).get();
  if (!row || row.bloqueadoAte <= now.getTime()) return { allowed: true, retryAfterSec: 0 };
  return { allowed: false, retryAfterSec: Math.ceil((row.bloqueadoAte - now.getTime()) / 1000) };
}

export async function recordLoginFailure(db: Db, key: string, now = new Date()): Promise<void> {
  const t = now.getTime();
  const expired = sql`${limitesTentativa.janelaInicio} < ${t - WINDOW_MS}`;
  await db
    .insert(limitesTentativa)
    .values({ chave: key, janelaInicio: t, contagem: 1, bloqueadoAte: 0 })
    .onConflictDoUpdate({
      target: limitesTentativa.chave,
      set: {
        contagem: sql`CASE WHEN ${expired} THEN 1 ELSE ${limitesTentativa.contagem} + 1 END`,
        janelaInicio: sql`CASE WHEN ${expired} THEN ${t} ELSE ${limitesTentativa.janelaInicio} END`,
        bloqueadoAte: sql`CASE WHEN (CASE WHEN ${expired} THEN 1 ELSE ${limitesTentativa.contagem} + 1 END) >= ${MAX_FAILURES} THEN ${t + BLOCK_MS} ELSE ${limitesTentativa.bloqueadoAte} END`,
      },
    })
    .run();
}

export async function clearLoginFailures(db: Db, key: string): Promise<void> {
  await db.delete(limitesTentativa).where(eq(limitesTentativa.chave, key)).run();
}
