// Limite de tentativas de login em memória (processo único). Reinicia com o servidor.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const BLOCK_MS = 15 * 60_000;

type Entry = { failures: number[]; blockedUntil: number };
const store = new Map<string, Entry>();

export function checkLoginAllowed(key: string, now = new Date()): { allowed: boolean; retryAfterSec: number } {
  const e = store.get(key);
  if (!e || e.blockedUntil <= now.getTime()) return { allowed: true, retryAfterSec: 0 };
  return { allowed: false, retryAfterSec: Math.ceil((e.blockedUntil - now.getTime()) / 1000) };
}

export function recordLoginFailure(key: string, now = new Date()): void {
  const t = now.getTime();
  const e = store.get(key) ?? { failures: [], blockedUntil: 0 };
  e.failures = e.failures.filter((f) => t - f < WINDOW_MS);
  e.failures.push(t);
  if (e.failures.length >= MAX_FAILURES) {
    e.blockedUntil = t + BLOCK_MS;
    e.failures = [];
  }
  store.set(key, e);
}

export function clearLoginFailures(key: string): void {
  store.delete(key);
}
