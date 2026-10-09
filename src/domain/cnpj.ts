export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

function checkDigit(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCnpj(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const d1 = checkDigit(d.slice(0, 12));
  const d2 = checkDigit(d.slice(0, 12) + d1);
  return d.endsWith(`${d1}${d2}`);
}

export function formatCnpj(input: string): string {
  const d = onlyDigits(input);
  if (d.length !== 14) return input;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
