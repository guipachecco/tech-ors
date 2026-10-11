import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import {
  countPendingChanges, createPushToken, listPendingChanges, listRuns, resolvePendingChanges, revokePushToken, saveSource,
  updateAllSources, updateFromFile, updateFromSource, verifyPushToken,
} from "@/modules/catalog/autoprice";
import { addCostOffer, listOffersForProduct } from "@/modules/catalog/costs/service";
import { createProducts, getProductView } from "@/modules/catalog/products/service";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import type { Db } from "@/infra/db/client";
import { fontesPreco, modelosImportacao, ofertasCusto, usuarios } from "@/infra/db/schema";
import { ValidationError } from "@/infra/validation";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;
const HEADER = "Código;Descrição;Preço";

beforeAll(() => {
  process.env.SESSION_SECRET = "s".repeat(40);
  process.env.TOTP_ENCRYPTION_KEY = "a".repeat(64);
});

async function saveMapping(db: Db, fornecedorId: number, mapping: Record<string, string>) {
  const values = { mapeamentoJson: JSON.stringify(mapping), padroesJson: "{}" };
  await db.insert(modelosImportacao).values({ fornecedorId, ...values }).onConflictDoUpdate({ target: modelosImportacao.fornecedorId, set: values }).run();
}

const csv = (...lines: string[]) => Buffer.from([HEADER, ...lines].join("\n"), "utf-8");

async function setup() {
  const db = await createTestDb();
  const mk = async (nome: string, perfil: "administrador" | "vendedor", podeVerCusto: boolean): Promise<SessionUser> => {
    const u = await db.insert(usuarios).values({ nome, email: `${nome}@x.com`, senhaHash: "h", perfil, podeVerCusto }).returning().get();
    return { id: u.id, nome, email: u.email, perfil, podeVerCusto };
  };
  const admin = await mk("adm", "administrador", true);
  const seller = await mk("ven", "vendedor", false);
  const supplier = await saveSupplier(db, admin, { nome: "Ingram" });
  const [ssd, ram] = await createProducts(db, admin, [
    { sku: "SSD-1", fabricante: "Kingston", modelo: "A400", categoria: "SSD" },
    { sku: "RAM-1", fabricante: "Kingston", modelo: "Fury", categoria: "Memória" },
  ]);
  await saveMapping(db, supplier.id, { codigo: "Código", descricao: "Descrição", custo: "Preço" });
  // custos de partida: SSD 100,00 / RAM 200,00 (vindos de importação anterior deste fornecedor, com o código dele)
  await addCostOffer(db, admin, { produtoId: ssd.id, fornecedorId: supplier.id, skuFornecedor: "SSD-1", custoCentavos: 10_000, obtidoEm: new Date(NOW.getTime() - 3 * DAY) });
  await addCostOffer(db, admin, { produtoId: ram.id, fornecedorId: supplier.id, skuFornecedor: "RAM-1", custoCentavos: 20_000, obtidoEm: new Date(NOW.getTime() - 3 * DAY) });
  return { db, admin, seller, supplier, ssd, ram };
}

describe("updateFromFile (automatic update)", () => {
  it("adds a new offer when the price changes within the limit and renews the validity when it does not", async () => {
    const { db, admin, supplier, ssd, ram } = await setup();
    const result = await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;105,00", "RAM-1;RAM;200,00"), fileName: "lista.csv", origem: "agendado" }, NOW);

    expect(result.status).toBe("ok");
    expect(result.resumo).toMatchObject({ linhas: 2, atualizados: 1, reconfirmados: 1, aguardandoRevisao: 0, naoCadastrados: 0, erros: 0 });

    const ssdOffers = await listOffersForProduct(db, admin, ssd.id);
    expect(ssdOffers.map((o) => o.custoCentavos)).toEqual([10_500, 10_000]); // histórico preservado
    const ramOffers = await listOffersForProduct(db, admin, ram.id);
    expect(ramOffers).toHaveLength(1); // preço igual: nenhuma linha nova...
    expect(ramOffers[0].obtidoEm.getTime()).toBe(NOW.getTime()); // ...só a validade foi renovada
    expect(ramOffers[0].validoAte.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("a price INCREASE shows up in the catalog right away (the old cheaper offer does not linger)", async () => {
    const { db, admin, supplier, ssd } = await setup();
    await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;120,00"), fileName: "lista.csv", origem: "agendado" }, NOW); // +20%, dentro do limite
    const view = await getProductView(db, admin, ssd.id, NOW);
    expect(view.custo?.custoCentavos).toBe(12_000);
    expect(view.statusCusto).toBe("valido");
  });

  it("holds a big price jump for review instead of applying it, and applies it once approved", async () => {
    const { db, admin, supplier, ssd } = await setup();
    const result = await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;150,00"), fileName: "lista.csv", origem: "envio" }, NOW); // +50%

    expect(result.status).toBe("revisar");
    expect(result.resumo?.aguardandoRevisao).toBe(1);
    expect((await listOffersForProduct(db, admin, ssd.id)).map((o) => o.custoCentavos)).toEqual([10_000]); // nada mudou
    const pending = await listPendingChanges(db, admin);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ anteriorCentavos: 10_000, novoCentavos: 15_000, produtoNome: "Kingston A400" });

    await resolvePendingChanges(db, admin, [pending[0].id], "aplicar", NOW);
    expect((await listOffersForProduct(db, admin, ssd.id)).map((o) => o.custoCentavos)).toEqual([15_000, 10_000]);
    expect(await countPendingChanges(db)).toBe(0);
  });

  it("discarding a pending change leaves the catalog alone", async () => {
    const { db, admin, supplier, ssd } = await setup();
    await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;300,00"), fileName: "l.csv", origem: "envio" }, NOW);
    const [p] = await listPendingChanges(db, admin);
    await resolvePendingChanges(db, admin, [p.id], "descartar", NOW);
    expect(await listOffersForProduct(db, admin, ssd.id)).toHaveLength(1);
    expect(await countPendingChanges(db)).toBe(0);
  });

  it("a newer file replaces the older pending change for the same product", async () => {
    const { db, admin, supplier } = await setup();
    await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;300,00"), fileName: "l.csv", origem: "envio" }, NOW);
    await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;310,00"), fileName: "l.csv", origem: "envio" }, new Date(NOW.getTime() + DAY));
    const pending = await listPendingChanges(db, admin);
    expect(pending).toHaveLength(1);
    expect(pending[0].novoCentavos).toBe(31_000);
  });

  it("counts unknown codes but never creates products on its own", async () => {
    const { db, supplier } = await setup();
    const result = await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;100,00", "NOVO-9;Coisa nova;50,00"), fileName: "l.csv", origem: "agendado" }, NOW);
    expect(result.resumo).toMatchObject({ naoCadastrados: 1, codigosNaoCadastrados: ["NOVO-9"] });
    expect(result.status).toBe("ok");
  });

  it("refuses a file whose layout looks broken and changes nothing", async () => {
    const { db, admin, supplier, ssd } = await setup();
    const result = await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;abc", "RAM-1;RAM;xyz", "X;Y;100,00"), fileName: "l.csv", origem: "agendado" }, NOW);
    expect(result.status).toBe("erro");
    expect(result.mensagem).toMatch(/formato da planilha/i);
    expect(await listOffersForProduct(db, admin, ssd.id)).toHaveLength(1);
  });

  it("reports changed columns instead of guessing", async () => {
    const { db, supplier } = await setup();
    const result = await updateFromFile(db, supplier.id, { buffer: Buffer.from("Part;Nome;Valor\nSSD-1;SSD;100,00"), fileName: "l.csv", origem: "agendado" }, NOW);
    expect(result.status).toBe("erro");
    expect(result.mensagem).toMatch(/colunas.*mudaram/i);
  });

  it("asks for a one-time manual mapping when the supplier was never configured", async () => {
    const { db, admin } = await setup();
    const other = await saveSupplier(db, admin, { nome: "ScanSource" });
    const result = await updateFromFile(db, other.id, { buffer: csv("SSD-1;SSD;100,00"), fileName: "l.csv", origem: "agendado" }, NOW);
    expect(result.status).toBe("erro");
    expect(result.mensagem).toMatch(/importação manual/i);
  });

  it("records an error run (instead of throwing) for an unreadable file, and logs every run in the history", async () => {
    const { db, admin, supplier } = await setup();
    const bad = await updateFromFile(db, supplier.id, { buffer: Buffer.alloc(0), fileName: "vazio.csv", origem: "envio" }, NOW);
    expect(bad.status).toBe("erro");
    await updateFromFile(db, supplier.id, { buffer: csv("SSD-1;SSD;101,00"), fileName: "l.csv", origem: "agendado" }, NOW);
    const runs = await listRuns(db, admin);
    expect(runs.map((r) => [r.origem, r.status])).toEqual([["agendado", "ok"], ["envio", "erro"]]);
    const source = await db.select().from(fontesPreco).where(eq(fontesPreco.fornecedorId, supplier.id)).get();
    expect(source?.ultimoSucessoEm?.getTime()).toBe(NOW.getTime());
  });

  it("applies the supplier's own validity (days) when the file has that column", async () => {
    const { db, supplier } = await setup();
    await saveMapping(db, supplier.id, { codigo: "Código", custo: "Preço", validadeDias: "Dias" });
    await updateFromFile(db, supplier.id, { buffer: Buffer.from("Código;Preço;Dias\nSSD-1;101,00;2"), fileName: "l.csv", origem: "agendado" }, NOW);
    const newest = await db.select().from(ofertasCusto).where(eq(ofertasCusto.custoCentavos, 10_100)).get();
    expect(newest!.validoAte.getTime()).toBe(NOW.getTime() + 2 * DAY);
  });

  it("reads Excel-style CSV with Windows-1252 accents and thousands separators", async () => {
    const { db, supplier } = await setup();
    const latin1 = Buffer.from("C\xf3digo;Descri\xe7\xe3o;Pre\xe7o\nSSD-1;SSD;1.050,00", "latin1");
    await saveMapping(db, supplier.id, { codigo: "Código", descricao: "Descrição", custo: "Preço" });
    const result = await updateFromFile(db, supplier.id, { buffer: latin1, fileName: "l.csv", origem: "agendado" }, NOW);
    expect(result.status).toBe("revisar"); // 10.500,00 vs 100,00: variação enorme
    expect(result.resumo?.aguardandoRevisao).toBe(1);
  });
});

describe("price source configuration", () => {
  it("only administrators configure sources and push keys", async () => {
    const { db, seller, supplier } = await setup();
    await expect(saveSource(db, seller, { fornecedorId: supplier.id, limiteVariacaoBps: 3000, ativo: true })).rejects.toThrow(ForbiddenError);
    await expect(createPushToken(db, seller, supplier.id)).rejects.toThrow(ForbiddenError);
  });

  it("normalizes share links, requires https and keeps the auth header encrypted", async () => {
    const { db, admin, supplier } = await setup();
    const saved = await saveSource(db, admin, {
      fornecedorId: supplier.id, urlArquivo: "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0",
      cabecalhoAuth: "Authorization: Bearer segredo", limiteVariacaoBps: 2500, ativo: true,
    });
    expect(saved.urlArquivo).toBe("https://docs.google.com/spreadsheets/d/abc123/export?format=xlsx");
    expect(saved.cabecalhoAuth).toBeTruthy();
    expect(saved.cabecalhoAuth).not.toContain("segredo");

    const kept = await saveSource(db, admin, { fornecedorId: supplier.id, urlArquivo: saved.urlArquivo!, limiteVariacaoBps: 2500, ativo: true });
    expect(kept.cabecalhoAuth).toBe(saved.cabecalhoAuth); // não informado = mantém

    await expect(saveSource(db, admin, { fornecedorId: supplier.id, urlArquivo: "http://x.com/a.xlsx", limiteVariacaoBps: 2500, ativo: true })).rejects.toThrow(ValidationError);
    await expect(saveSource(db, admin, { fornecedorId: supplier.id, urlArquivo: "https://x.com/a.xlsx", cabecalhoAuth: "sem formato", limiteVariacaoBps: 2500, ativo: true })).rejects.toThrow(ValidationError);
  });

  it("push key: shown once, stored hashed, verifiable, replaceable and revocable", async () => {
    const { db, admin, supplier } = await setup();
    const token = await createPushToken(db, admin, supplier.id);
    const stored = await db.select().from(fontesPreco).where(eq(fontesPreco.fornecedorId, supplier.id)).get();
    expect(stored?.tokenHash).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(token);

    expect(await verifyPushToken(db, supplier.id, token)).toBe(true);
    expect(await verifyPushToken(db, supplier.id, token + "x")).toBe(false);
    expect(await verifyPushToken(db, supplier.id, "")).toBe(false);

    const second = await createPushToken(db, admin, supplier.id);
    expect(await verifyPushToken(db, supplier.id, token)).toBe(false);
    expect(await verifyPushToken(db, supplier.id, second)).toBe(true);

    await revokePushToken(db, admin, supplier.id);
    expect(await verifyPushToken(db, supplier.id, second)).toBe(false);
  });
});

describe("link source (scheduled)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const URL = "https://93.184.216.34/lista.csv";

  it("downloads the supplier's link with the saved login and applies it", async () => {
    const { db, admin, supplier, ssd } = await setup();
    await saveSource(db, admin, { fornecedorId: supplier.id, urlArquivo: URL, cabecalhoAuth: "Authorization: Bearer abc", limiteVariacaoBps: 3000, ativo: true });
    const fetchMock = vi.fn().mockResolvedValue(new Response(csv("SSD-1;SSD;102,00")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateFromSource(db, supplier.id, "manual", NOW);
    expect(result.status).toBe("ok");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer abc");
    expect((await listOffersForProduct(db, admin, ssd.id))[0].custoCentavos).toBe(10_200);
  });

  it("records a failed download as an error run instead of throwing", async () => {
    const { db, admin, supplier } = await setup();
    await saveSource(db, admin, { fornecedorId: supplier.id, urlArquivo: URL, limiteVariacaoBps: 3000, ativo: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    const result = await updateFromSource(db, supplier.id, "agendado", NOW);
    expect(result).toMatchObject({ status: "erro" });
    expect((await listRuns(db, admin))[0]).toMatchObject({ origem: "agendado", status: "erro" });
  });

  it("the daily routine runs every active supplier with a link, isolating failures, and skips paused ones", async () => {
    const { db, admin, supplier } = await setup();
    const paused = await saveSupplier(db, admin, { nome: "Pausado" });
    const broken = await saveSupplier(db, admin, { nome: "Quebrado" });
    await saveSource(db, admin, { fornecedorId: supplier.id, urlArquivo: URL, limiteVariacaoBps: 3000, ativo: true });
    await saveSource(db, admin, { fornecedorId: paused.id, urlArquivo: URL, limiteVariacaoBps: 3000, ativo: false });
    await saveSource(db, admin, { fornecedorId: broken.id, urlArquivo: "https://8.8.8.8/x.csv", limiteVariacaoBps: 3000, ativo: true });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (u: URL) => (u.hostname === "8.8.8.8" ? new Response("", { status: 500 }) : new Response(csv("SSD-1;SSD;100,00")))));

    const out = await updateAllSources(db, NOW);
    expect(out.map((o) => [o.nome, "resultado" in o && "status" in o.resultado ? o.resultado.status : "?"]).sort()).toEqual([["Ingram", "ok"], ["Quebrado", "erro"]]);
  });

  it("refuses to run a supplier that has no link", async () => {
    const { db, supplier } = await setup();
    await expect(updateFromSource(db, supplier.id, "manual", NOW)).rejects.toThrow(ValidationError);
  });
});
