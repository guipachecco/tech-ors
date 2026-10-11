/**
 * Transforma o link de compartilhamento mais comum (Google Planilhas, Google Drive, Dropbox) no link de
 * download direto do arquivo. Qualquer outro endereço é devolvido como está.
 */
export function toDirectDownloadUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  const host = u.hostname.toLowerCase();

  if (host === "docs.google.com") {
    const m = /^\/spreadsheets\/d\/([\w-]+)/.exec(u.pathname);
    if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
  }
  if (host === "drive.google.com") {
    const id = /^\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (host === "dropbox.com" || host.endsWith(".dropbox.com")) {
    u.searchParams.delete("dl");
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return u.toString();
}
