import { describe, expect, it } from "vitest";
import { can, type Action } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit";
import { auditoria } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/sessions";
import { createTestDb } from "./helpers/testDb";

const user = (perfil: SessionUser["perfil"], podeVerCusto: boolean): SessionUser => ({
  id: 1,
  nome: "U",
  email: "u@x.com",
  perfil,
  podeVerCusto,
});

const ALL: Action[] = ["cost:view", "cost:write", "margin:manage", "quote:override", "user:manage", "settings:manage", "admin:manage"];

describe("can", () => {
  it("administrator can do everything except managing administrators", () => {
    for (const a of ALL.filter((x) => x !== "admin:manage")) expect(can(user("administrador", false), a)).toBe(true);
    expect(can(user("administrador", true), "admin:manage")).toBe(false);
  });
  it("root can do everything, including managing administrators", () => {
    for (const a of ALL) expect(can(user("root", false), a)).toBe(true);
  });
  it("seller without cost permission can do nothing privileged", () => {
    for (const a of ALL) expect(can(user("vendedor", false), a)).toBe(false);
  });
  it("seller with cost permission only gets cost actions", () => {
    const u = user("vendedor", true);
    expect(can(u, "cost:view")).toBe(true);
    expect(can(u, "cost:write")).toBe(true);
    for (const a of ALL.filter((x) => !x.startsWith("cost:"))) expect(can(u, a)).toBe(false);
  });
});

describe("recordAudit", () => {
  it("stores before/after as JSON and strips sensitive keys", () => {
    const db = createTestDb();
    recordAudit(db, {
      userId: null,
      acao: "teste",
      entidade: "usuario",
      entidadeId: 5,
      antes: { nome: "A", senhaHash: "segredo" },
      depois: { nome: "B", nested: { token: "t", ok: 1 } },
    });
    const row = db.select().from(auditoria).get()!;
    expect(row.antes).toBe(JSON.stringify({ nome: "A" }));
    expect(row.depois).toBe(JSON.stringify({ nome: "B", nested: { ok: 1 } }));
    expect(`${row.antes}${row.depois}`).not.toContain("segredo");
  });
});
