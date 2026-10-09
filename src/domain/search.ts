/** minúsculas, sem acentos, só letras/números separados por espaço. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchTokens(query: string): string[] {
  const n = normalizeSearch(query);
  return n ? n.split(" ") : [];
}
