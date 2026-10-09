import { describe, expect, it } from "vitest";
import { loadConfig } from "@/infra/config";

const secret = "x".repeat(32);

describe("loadConfig", () => {
  it("rejects short session secrets", () => {
    expect(() => loadConfig({ SESSION_SECRET: "x".repeat(31) })).toThrow();
  });
  it("defaults the database to a local file under LOCALAPPDATA", () => {
    const c = loadConfig({ SESSION_SECRET: secret, LOCALAPPDATA: String.raw`C:\Users\u\AppData\Local` });
    expect(c.databaseUrl.startsWith("file:")).toBe(true);
    expect(c.databaseUrl.endsWith(String.raw`TechMasterOrcamentos\orcamentos.db`)).toBe(true);
    expect(c.databaseAuthToken).toBeUndefined();
  });
  it("accepts the legacy DATABASE_PATH as a file URL", () => {
    const p = String.raw`D:\db\o.db`;
    expect(loadConfig({ SESSION_SECRET: secret, DATABASE_PATH: p }).databaseUrl).toBe(`file:${p}`);
  });
  it("prefers DATABASE_URL, then the Turso variables, then DATABASE_PATH", () => {
    const base = { SESSION_SECRET: secret, DATABASE_PATH: "x.db" };
    expect(loadConfig({ ...base, TURSO_DATABASE_URL: "libsql://t.turso.io", TURSO_AUTH_TOKEN: "tok" })).toMatchObject({ databaseUrl: "libsql://t.turso.io", databaseAuthToken: "tok" });
    expect(loadConfig({ ...base, DATABASE_URL: "libsql://a.turso.io", TURSO_DATABASE_URL: "libsql://b.turso.io", DATABASE_AUTH_TOKEN: "own" })).toMatchObject({
      databaseUrl: "libsql://a.turso.io",
      databaseAuthToken: "own",
    });
  });
  it("ignores blank values", () => {
    expect(loadConfig({ SESSION_SECRET: secret, DATABASE_URL: "  ", DATABASE_PATH: "y.db" }).databaseUrl).toBe("file:y.db");
  });
});
