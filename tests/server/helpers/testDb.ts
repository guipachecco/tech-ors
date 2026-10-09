import { openDatabase, type Db } from "@/server/db/client";

export function createTestDb(): Db {
  return openDatabase(":memory:");
}
