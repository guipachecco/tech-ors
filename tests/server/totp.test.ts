import { describe, expect, it } from "vitest";
import {
  decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, newTotpSecret, totpUri, verifyTotp,
} from "@/server/auth/totp";

// Vetor de teste da RFC 6238: segredo ASCII "12345678901234567890", T=59s → 287082 (6 dígitos, SHA-1).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const KEY = "a1".repeat(32);

describe("verifyTotp", () => {
  it("accepts the RFC 6238 vector and reports the time step", () => {
    expect(verifyTotp(RFC_SECRET, "287082", null, new Date(59_000))).toEqual({ ok: true, step: 1 });
  });
  it("tolerates one step of clock drift and rejects further", () => {
    expect(verifyTotp(RFC_SECRET, "287082", null, new Date(59_000 + 30_000)).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, "287082", null, new Date(59_000 + 90_000)).ok).toBe(false);
  });
  it("rejects replay of a step already used", () => {
    expect(verifyTotp(RFC_SECRET, "287082", 1, new Date(59_000)).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, "287082", 0, new Date(59_000)).ok).toBe(true);
  });
  it("accepts spaces but rejects malformed codes", () => {
    expect(verifyTotp(RFC_SECRET, "287 082", null, new Date(59_000)).ok).toBe(true);
    for (const bad of ["", "12345", "1234567", "abcdef", "287082a"]) {
      expect(verifyTotp(RFC_SECRET, bad, null, new Date(59_000)).ok).toBe(false);
    }
  });
});

describe("secret handling", () => {
  it("generates base32 secrets of 160 bits", () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(newTotpSecret()).not.toBe(s);
  });
  it("encrypts with AES-256-GCM and detects tampering or the wrong key", () => {
    const blob = encryptSecret(RFC_SECRET, KEY);
    expect(blob).not.toContain(RFC_SECRET);
    expect(decryptSecret(blob, KEY)).toBe(RFC_SECRET);
    expect(encryptSecret(RFC_SECRET, KEY)).not.toBe(blob); // IV aleatório
    expect(() => decryptSecret(blob, "b2".repeat(32))).toThrow();
    const parts = blob.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), KEY)).toThrow();
  });
  it("rejects keys that are not 32 bytes of hex", () => {
    expect(() => encryptSecret("x", "curta")).toThrow();
  });
  it("builds an otpauth URI for Google Authenticator", () => {
    const uri = totpUri("ana@x.com", RFC_SECRET);
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("issuer=TechMaster");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("recovery codes", () => {
  it("generates 10 unique codes and hashes them regardless of dashes or case", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const c = codes[0];
    expect(hashRecoveryCode(c)).toBe(hashRecoveryCode(c.toLowerCase().replace("-", " ")));
    expect(hashRecoveryCode(c)).not.toBe(hashRecoveryCode(codes[1]));
    expect(hashRecoveryCode(c)).not.toContain(c.replace("-", ""));
  });
});
