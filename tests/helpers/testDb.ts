import { openDatabase, type Db } from "@/infra/db/client";

/** Banco novo, em memória e já migrado, para cada teste. */
export async function createTestDb(): Promise<Db> {
  return openDatabase(":memory:");
}
