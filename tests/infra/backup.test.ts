import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkBackup, runBackup } from "@/infra/backup";
import { openDatabase } from "@/infra/db/client";
import { fornecedores } from "@/infra/db/schema";

describe("backup", () => {
  it("creates a consistent, verifiable copy and prunes old ones", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orc-backup-"));
    try {
      const db = openDatabase(path.join(dir, "live.db"));
      db.insert(fornecedores).values({ nome: "F" }).run();
      const dest = path.join(dir, "bk");
      fs.mkdirSync(dest);
      fs.writeFileSync(path.join(dest, "orcamentos-2026-08-01.db"), "old"); // 69 dias → remove
      fs.writeFileSync(path.join(dest, "orcamentos-2026-09-20.db"), "recent"); // 19 dias → mantém
      fs.writeFileSync(path.join(dest, "outro-arquivo.txt"), "x"); // não é backup → mantém

      const file = await runBackup(db, dest, new Date("2026-10-09T12:00:00Z"));
      expect(path.basename(file)).toBe("orcamentos-2026-10-09.db");
      expect(checkBackup(file)).toMatchObject({ ok: true, integrity: "ok" });
      expect(fs.readdirSync(dest).sort()).toEqual(["orcamentos-2026-09-20.db", "orcamentos-2026-10-09.db", "outro-arquivo.txt"]);

      const restored = openDatabase(file);
      expect(restored.select().from(fornecedores).all()).toHaveLength(1);
      (restored as unknown as { $client: { close(): void } }).$client.close();
      (db as unknown as { $client: { close(): void } }).$client.close();
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // limpeza da pasta temporária é best-effort (o Windows pode manter o arquivo -wal bloqueado)
      }
    }
  });
});
