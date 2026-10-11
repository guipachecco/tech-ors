import dns from "node:dns/promises";
import net from "node:net";

/** Falha ao baixar o arquivo de um fornecedor; a mensagem é própria para aparecer na tela. */
export class RemoteFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteFileError";
  }
}

/** Endereços que nunca devem ser acessados a partir do servidor (rede interna, localhost, metadados de nuvem). */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return true;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new RemoteFileError("O link precisa começar com https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new RemoteFileError("Este endereço não é permitido.");
  }
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new RemoteFileError("Não consegui encontrar o endereço do link.");
  if (addresses.some(isPrivateAddress)) throw new RemoteFileError("Este endereço não é permitido.");
}

export type RemoteFile = { buffer: Buffer; fileName: string };

/**
 * Baixa um arquivo de um link https público: sem seguir para rede interna, com tempo e tamanho máximos.
 * `headers` leva a autenticação, quando o fornecedor exige.
 */
export async function downloadFile(
  rawUrl: string, opts: { headers?: Record<string, string>; maxBytes: number; timeoutMs?: number },
): Promise<RemoteFile> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteFileError("O link da planilha não é válido.");
  }
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 25_000);
  let sendHeaders = opts.headers ?? {};

  for (let hop = 0; hop <= 4; hop++) {
    await assertPublicHost(url);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal, headers: { "user-agent": "TechMaster-Orcamentos/1.0", accept: "*/*", ...sendHeaders } });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new RemoteFileError(timedOut ? "O fornecedor demorou demais para responder." : "Não consegui acessar o link do fornecedor.");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new RemoteFileError("O link redireciona para lugar nenhum.");
      const next = new URL(location, url);
      if (next.host !== url.host) sendHeaders = {}; // nunca repassa a autenticação para outro site
      url = next;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new RemoteFileError("O fornecedor recusou o acesso (confira o login/chave do link).");
    if (!res.ok) throw new RemoteFileError(`O fornecedor respondeu com erro ${res.status}.`);

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > opts.maxBytes) throw new RemoteFileError("O arquivo é grande demais.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new RemoteFileError("O fornecedor não devolveu nenhum arquivo.");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        await reader.cancel();
        throw new RemoteFileError("O arquivo é grande demais.");
      }
      chunks.push(value);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
    const rawName = named ?? url.pathname.split("/").pop() ?? "";
    let fileName = rawName;
    try {
      fileName = decodeURIComponent(rawName);
    } catch {
      /* nome com % solto: usa como veio */
    }
    return { buffer: Buffer.concat(chunks), fileName: (fileName || "planilha").slice(0, 120) };
  }
  throw new RemoteFileError("O link redireciona vezes demais.");
}
