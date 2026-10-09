import { describe, expect, it } from "vitest";
import { loadConfig } from "@/infra/config";

const secret = "x".repeat(32);

describe("loadConfig", () => {
  it("rejects short session secrets", () => {
    expect(() => loadConfig({ SESSION_SECRET: "x".repeat(31) })).toThrow();
  });
  it("defaults the database to LOCALAPPDATA", () => {
    const c = loadConfig({ SESSION_SECRET: secret, LOCALAPPDATA: String.raw`C:\Users\u\AppData\Local` });
    expect(c.databasePath.endsWith(String.raw`TechMasterOrcamentos\orcamentos.db`)).toBe(true);
  });
  it("prefers explicit DATABASE_PATH", () => {
    const p = String.raw`D:\db\o.db`;
    expect(loadConfig({ SESSION_SECRET: secret, DATABASE_PATH: p }).databasePath).toBe(p);
  });
});
