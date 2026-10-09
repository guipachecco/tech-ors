import { openDatabase, type Db } from "@/infra/db/client";

export function createTestDb(): Db {
  return openDatabase(":memory:");
}
