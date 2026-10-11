import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/modules/auth/sessions";
import { addCostOffer } from "@/modules/catalog/costs/service";
import { saveProduct } from "@/modules/catalog/products/service";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import { saveClient } from "@/modules/clients/service";
import { auditoria, usuarios } from "@/infra/db/schema";
import { NotFoundError, ValidationError } from "@/infra/validation";
import {
  addProductItem, createQuote, getQuote, getQuoteByToken, regeneratePublicLink, respondAsClient, sendQuote,
} from "@/modules/quotes/service";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;

async function setup() {
  const db = await createTestDb();
  const u = await db.insert(usuarios).values({ nome: "adm", email: "a@x.com", senhaHash: "h", perfil: "administrador", podeVerCusto: true }).returning().get();
  const admin: SessionUser = { id: u.id, nome: "adm", email: u.email, perfil: "administrador", podeVerCusto: true };
  const supplier = await saveSupplier(db, admin, { nome: "F" });
  const client = await saveClient(db, admin, { razaoSocial: "Cliente" });
  const product = await saveProduct(db, admin, { sku: "NB1", fabricante: "SMS", modelo: "Nobreak", categoria: "Nobreak" });
  await addCostOffer(db, admin, { produtoId: product.id, fornecedorId: supplier.id, custoCentavos: 100_000 }, NOW);
  const draft = await createQuote(db, admin, client.id, NOW);
  await addProductItem(db, admin, draft.id, product.id, 1, NOW);
  const sent = await sendQuote(db, admin, draft.id, {}, NOW);
  return { db, admin, draft, sent, token: sent.tokenPublico! };
}

describe("client link", () => {
  it("is created when the quote is sent and not before", async () => {
    const { db, admin, draft, token } = await setup();
    expect(draft.tokenPublico).toBeNull(); // o rascunho original, antes do envio
    const another = await createQuote(db, admin, draft.clienteId, NOW);
    expect(another.tokenPublico).toBeNull();
    expect(await getQuoteByToken(db, token)).not.toBeNull();
  });

  it("finds the quote only for a well-formed, existing token", async () => {
    const { db, sent, token } = await setup();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await getQuoteByToken(db, token))?.id).toBe(sent.id);
    expect(await getQuoteByToken(db, "x")).toBeNull();
    expect(await getQuoteByToken(db, "a".repeat(32))).toBeNull();
    expect(await getQuoteByToken(db, "' OR 1=1 --")).toBeNull();
  });

  it("the client approves: status, name and time are recorded, and the audit has no staff user", async () => {
    const { db, sent, token } = await setup();
    const after = await respondAsClient(db, token, { resultado: "aprovado", nome: "  Maria Souza " }, { ip: "203.0.113.9" }, new Date(NOW.getTime() + DAY));
    expect(after).toMatchObject({ status: "aprovado", respondidoPorNome: "Maria Souza" });
    expect(after.respondidoEm?.getTime()).toBe(NOW.getTime() + DAY);
    const log = await db.select().from(auditoria).orderBy(desc(auditoria.id)).limit(1).get();
    expect(log).toMatchObject({ usuarioId: null, acao: "orcamento.aprovado_pelo_cliente", entidadeId: sent.id });
    expect(log?.depois).toContain("203.0.113.9");
  });

  it("refusing requires a reason; the name is always required", async () => {
    const { db, token } = await setup();
    await expect(respondAsClient(db, token, { resultado: "recusado", nome: "Maria" }, {}, NOW)).rejects.toThrow(ValidationError);
    await expect(respondAsClient(db, token, { resultado: "aprovado", nome: " " }, {}, NOW)).rejects.toThrow(ValidationError);
    const after = await respondAsClient(db, token, { resultado: "recusado", nome: "Maria", motivo: "Achamos caro" }, {}, NOW);
    expect(after).toMatchObject({ status: "recusado", motivoResultado: "Achamos caro" });
  });

  it("answers only once", async () => {
    const { db, token } = await setup();
    await respondAsClient(db, token, { resultado: "aprovado", nome: "Maria" }, {}, NOW);
    await expect(respondAsClient(db, token, { resultado: "recusado", nome: "João", motivo: "mudei de ideia" }, {}, NOW)).rejects.toThrow(/já foi respondido/);
  });

  it("refuses an answer after the proposal expired", async () => {
    const { db, sent, token } = await setup();
    await expect(respondAsClient(db, token, { resultado: "aprovado", nome: "Maria" }, {}, new Date(sent.validoAte.getTime() + 1))).rejects.toThrow(/expirou/);
    expect((await getQuote(db, sent.id)).status).toBe("enviado");
  });

  it("unknown tokens are 'not found'", async () => {
    const { db } = await setup();
    await expect(respondAsClient(db, "b".repeat(32), { resultado: "aprovado", nome: "Maria" }, {}, NOW)).rejects.toThrow(NotFoundError);
  });

  it("regenerating the link kills the old one", async () => {
    const { db, admin, sent, token } = await setup();
    const fresh = await regeneratePublicLink(db, admin, sent.id);
    expect(fresh).not.toBe(token);
    expect(await getQuoteByToken(db, token)).toBeNull();
    expect((await getQuoteByToken(db, fresh))?.id).toBe(sent.id);
    const row = await db.select().from(auditoria).where(eq(auditoria.acao, "orcamento.link_renovar")).get();
    expect(row?.entidadeId).toBe(sent.id);
  });

  it("a draft has no link to regenerate", async () => {
    const { db, admin, draft } = await setup();
    const other = await createQuote(db, admin, draft.clienteId, NOW);
    await expect(regeneratePublicLink(db, admin, other.id)).rejects.toThrow(ValidationError);
  });
});
