import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import * as OTPAuth from "otpauth";

const ISSUER = "TechMaster Orçamentos";
const PERIOD = 30;

// ---------- segredo TOTP ----------

/** Segredo de 160 bits em base32 (formato aceito pelo Google Authenticator). */
export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(email: string, secretBase32: string): string {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).toString();
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Valida o código de 6 dígitos com tolerância de ±1 passo (30 s).
 * `lastStep` impede reutilizar um código já aceito (replay).
 */
export function verifyTotp(secretBase32: string, code: string, lastStep: number | null, now = new Date()): TotpResult {
  const token = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return { ok: false };
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token, timestamp: now.getTime(), window: 1 });
  if (delta === null) return { ok: false };
  const step = Math.floor(now.getTime() / 1000 / PERIOD) + delta;
  if (lastStep !== null && step <= lastStep) return { ok: false };
  return { ok: true, step };
}

// ---------- criptografia do segredo em repouso (AES-256-GCM) ----------

function keyBuffer(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("TOTP_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes).");
  return Buffer.from(keyHex, "hex");
}

/** Formato: v1:<iv>:<tag>:<texto cifrado>, tudo em base64. */
export function encryptSecret(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(keyHex), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(blob: string, keyHex: string): string {
  const [version, iv, tag, enc] = blob.split(":");
  if (version !== "v1" || !iv || !tag || !enc) throw new Error("Segredo 2FA em formato inválido.");
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(keyHex), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]).toString("utf8");
}

// ---------- códigos de recuperação ----------

// Sem 0/O/1/I/L para evitar confusão ao digitar.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}
