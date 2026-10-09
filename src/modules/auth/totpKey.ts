import { loadConfig } from "@/infra/config";

/** Chave de criptografia dos segredos 2FA. Falha cedo, com mensagem clara, se não estiver no .env. */
export function totpKey(): string {
  const key = loadConfig().totpEncryptionKey;
  if (!key) throw new Error("Defina TOTP_ENCRYPTION_KEY no arquivo .env (veja .env.example) para usar o 2FA.");
  return key;
}
