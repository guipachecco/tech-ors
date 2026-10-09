import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 10;

export function validatePasswordStrength(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
}

// algorithm 2 = Argon2id
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: 2 });
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
