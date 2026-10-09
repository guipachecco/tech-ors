import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkBackup, dumpSql, restoreDump, runBackup } from "@/infra/backup";
import { createDb, openDatabase } from "@/infra/db/client";
import { fornecedores, produtoFotos, produtos } from "@/infra/db/schema";

const NOW = new Date("2026-10-09T12:00:00Z");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "orc-backup-"));
const cleanup = (dir: string) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // limpeza de pasta temporária é best-effort (o Windows pode manter o arquivo aberto por instantes)
  }
};

describe("backup de banco em arquivo", () => {
  it("cria uma cópia exata e verificável e remove as antigas", async () => {
    const dir = tmp();
    try {
      const db = await openDatabase(`file:${path.join(dir, "live.db")}`);
      await db.insert(fornecedores).values({ nome: "F" }).run();
      const dest = path.join(dir, "bk");
      fs.mkdirSync(dest);
      fs.writeFileSync(path.join(dest, "orcamentos-2026-08-01.db"), "old"); // 69 dias → remove
      fs.writeFileSync(path.join(dest, "orcamentos-2026-08-02.sql"), "old"); // idem, formato .sql
      fs.writeFileSync(path.join(dest, "orcamentos-2026-09-20.db"), "recent"); // 19 dias → mantém
      fs.writeFileSync(path.join(dest, "outro-arquivo.txt"), "x"); // não é backup → mantém

      const file = await runBackup(db, dest, NOW);
      expect(path.basename(file)).toBe("orcamentos-2026-10-09.db");
      expect(await checkBackup(file)).toMatchObject({ ok: true, integrity: "ok" });
      expect(fs.readdirSync(dest).sort()).toEqual(["orcamentos-2026-09-20.db", "orcamentos-2026-10-09.db", "outro-arquivo.txt"]);

      const restored = await openDatabase(`file:${file}`);
      expect(await restored.select().from(fornecedores).all()).toHaveLength(1);
      restored.$client.close();
      db.$client.close();
    } finally {
      cleanup(dir);
    }
  });

  it("com format sql exporta um banco em arquivo para .sql (migração para a nuvem)", async () => {
    const dir = tmp();
    try {
      const db = await openDatabase(`file:${path.join(dir, "live.db")}`);
      await db.insert(fornecedores).values({ nome: "Loja d'Ouro" }).run();
      const file = await runBackup(db, path.join(dir, "bk"), NOW, 30, "sql");
      expect(path.basename(file)).toBe("orcamentos-2026-10-09.sql");
      expect(await checkBackup(file)).toMatchObject({ ok: true });

      const target = createDb(":memory:"); // banco vazio, sem migrar: como um Turso novo
      await restoreDump(target, file);
      expect((await target.select().from(fornecedores).all())[0]?.nome).toBe("Loja d'Ouro");
      db.$client.close();
    } finally {
      cleanup(dir);
    }
  });

  it("rodar duas vezes no mesmo dia substitui o arquivo", async () => {
    const dir = tmp();
    try {
      const db = await openDatabase(`file:${path.join(dir, "live.db")}`);
      const a = await runBackup(db, path.join(dir, "bk"), NOW);
      await db.insert(fornecedores).values({ nome: "Novo" }).run();
      const b = await runBackup(db, path.join(dir, "bk"), NOW);
      expect(b).toBe(a);
      const check = createDb(`file:${b}`);
      expect(await check.select().from(fornecedores).all()).toHaveLength(1);
      check.$client.close();
      db.$client.close();
    } finally {
      cleanup(dir);
    }
  });
});

describe("exportação SQL (banco na nuvem)", () => {
  it("exporta e restaura tudo, inclusive textos com aspas e fotos (binário)", async () => {
    const dir = tmp();
    try {
      const db = await openDatabase(":memory:");
      const prod = await db.insert(produtos).values({ sku: "S'1", fabricante: 'Dell "X"', modelo: "R260", categoria: "Servidor", busca: "x" }).returning().get();
      const photo = Buffer.from([0, 1, 2, 250, 255, 39, 34]);
      await db.insert(produtoFotos).values({ produtoId: prod.id, dados: photo }).run();
      await db.insert(fornecedores).values({ nome: "Çedilha; DROP TABLE x;--\nlinha 2" }).run();

      const file = path.join(dir, "dump.sql");
      const stats = await dumpSql(db, file);
      expect(stats.tables).toBeGreaterThan(10);
      expect(stats.rows).toBeGreaterThanOrEqual(3);
      expect(await checkBackup(file)).toMatchObject({ ok: true, integrity: "ok" });

      const empty = createDb(":memory:");
      await restoreDump(empty, file);
      const p = await empty.select().from(produtos).get();
      expect(p).toMatchObject({ sku: "S'1", fabricante: 'Dell "X"' });
      expect(Buffer.from((await empty.select().from(produtoFotos).get())!.dados).equals(photo)).toBe(true);
      expect((await empty.select().from(fornecedores).get())!.nome).toBe("Çedilha; DROP TABLE x;--\nlinha 2");
    } finally {
      cleanup(dir);
    }
  });

  it("recusa restaurar em banco que já tem tabelas", async () => {
    const dir = tmp();
    try {
      const db = await openDatabase(":memory:");
      const file = path.join(dir, "dump.sql");
      await dumpSql(db, file);
      await expect(restoreDump(db, file)).rejects.toThrow(/não está vazio/);
    } finally {
      cleanup(dir);
    }
  });
});
