import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/modules/auth/permissions";
import type { SessionUser } from "@/modules/auth/sessions";
import { addCostOffer } from "@/modules/catalog/costs/service";
import { saveProduct } from "@/modules/catalog/products/service";
import { getSettings, saveSettings } from "@/modules/catalog/settings/service";
import { saveSupplier } from "@/modules/catalog/suppliers/service";
import { saveClient } from "@/modules/clients/service";
import { usuarios } from "@/infra/db/schema";
import { ValidationError } from "@/infra/validation";
import { QuoteLockedError, SendBlockedError } from "@/modules/quotes/errors";
import {
  addProductItem, addServiceItem, approvalChanges, approveQuote, cancelApproval, createQuote, getItems, getQuote,
  listPendingApprovals, repriceQuote, requestApproval, sendQuote, updateItem,
} from "@/modules/quotes/service";
import { createTestDb } from "../../helpers/testDb";

const NOW = new Date("2026-10-09T12:00:00Z");
const LATER = new Date(NOW.getTime() + 60_000);

async function setup() {
  const db = await createTestDb();
  const mk = async (nome: string, perfil: "administrador" | "vendedor", podeVerCusto: boolean): Promise<SessionUser> => {
    const u = await db.insert(usuarios).values({ nome, email: `${nome}@x.com`, senhaHash: "h", perfil, podeVerCusto }).returning().get();
    return { id: u.id, nome, email: u.email, perfil, podeVerCusto };
  };
  const admin = await mk("adm", "administrador", true);
  const seller = await mk("ven", "vendedor", false);
  const seller2 = await mk("ven2", "vendedor", false);
  const supplier = await saveSupplier(db, admin, { nome: "F" });
  const client = await saveClient(db, admin, { razaoSocial: "Cliente" });
  const nb = await saveProduct(db, admin, { sku: "NB1", fabricante: "SMS", modelo: "Nobreak", categoria: "Nobreak" });
  const sw = await saveProduct(db, admin, { sku: "SW1", fabricante: "TP-Link", modelo: "Switch", categoria: "Switch" });
  await addCostOffer(db, admin, { produtoId: nb.id, fornecedorId: supplier.id, custoCentavos: 100_000 }, NOW);
  await addCostOffer(db, admin, { produtoId: sw.id, fornecedorId: supplier.id, custoCentavos: 50_000 }, NOW);
  const quote = await createQuote(db, seller, client.id, NOW);
  await addProductItem(db, seller, quote.id, nb.id, 2, NOW);
  await addProductItem(db, seller, quote.id, sw.id, 1, NOW);
  return { db, admin, seller, seller2, supplier, client, nb, sw, quote };
}

describe("repriceQuote (atualizar todos os preços)", () => {
  it("brings every product up to the current catalog cost and reports only real price changes", async () => {
    const { db, admin, seller, supplier, nb, quote } = await setup();
    await addCostOffer(db, admin, { produtoId: nb.id, fornecedorId: supplier.id, custoCentavos: 90_000 }, LATER); // sw não muda

    const changes = await repriceQuote(db, seller, quote.id, LATER);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ precoAntesCentavos: 125_000, precoDepoisCentavos: 112_500 });
    const items = await getItems(db, quote.id);
    expect(items.map((i) => i.custoCentavos)).toEqual([90_000, 50_000]);
  });

  it("reports (without touching) items whose product no longer has a valid cost", async () => {
    const { db, seller, quote } = await setup();
    const far = new Date(NOW.getTime() + 60 * 86_400_000); // custos de 7 dias já venceram
    const changes = await repriceQuote(db, seller, quote.id, far);
    expect(changes.every((c) => c.precoDepoisCentavos === null)).toBe(true);
    expect((await getItems(db, quote.id))[0].custoCentavos).toBe(100_000);
  });
});

describe("internal approval", () => {
  it("request → locks editing → approver approves and sends in one click", async () => {
    const { db, admin, seller, quote } = await setup();
    const { quote: pending } = await requestApproval(db, seller, quote.id, NOW);
    expect(pending).toMatchObject({ aprovacaoStatus: "pendente", aprovacaoPedidaPor: seller.id });

    const item = (await getItems(db, quote.id))[0];
    await expect(updateItem(db, seller, item.id, { quantidade: 5 })).rejects.toThrow(QuoteLockedError);
    await expect(addServiceItem(db, seller, quote.id, { descricao: "x", quantidade: 1, precoUnitarioCentavos: 1 })).rejects.toThrow(/aguardando aprovação/);

    expect((await listPendingApprovals(db, admin)).map((p) => p.id)).toEqual([quote.id]);
    const sent = await approveQuote(db, admin, quote.id, { enviar: true }, NOW);
    expect(sent.status).toBe("enviado");
    expect(sent.aprovacaoStatus).toBe("aprovada");
    expect(sent.aprovadoPor).toBe(admin.id);
    expect(sent.tokenPublico).toBeTruthy();
    expect(await listPendingApprovals(db, admin)).toHaveLength(0);
  });

  it("updates prices when requested and keeps what changed for the reviewer", async () => {
    const { db, admin, seller, supplier, nb, quote } = await setup();
    await addCostOffer(db, admin, { produtoId: nb.id, fornecedorId: supplier.id, custoCentavos: 110_000 }, LATER);
    const { mudancas } = await requestApproval(db, seller, quote.id, LATER);
    expect(mudancas).toHaveLength(1);
    expect(approvalChanges(await getQuote(db, quote.id))).toEqual(mudancas);
  });

  it("only reviewers (admins) can approve or return; a seller can withdraw their own request", async () => {
    const { db, admin, seller, seller2, quote } = await setup();
    await requestApproval(db, seller, quote.id, NOW);
    await expect(approveQuote(db, seller, quote.id, {}, NOW)).rejects.toThrow(ForbiddenError);
    await expect(listPendingApprovals(db, seller)).rejects.toThrow(ForbiddenError);
    await expect(cancelApproval(db, seller2, quote.id)).rejects.toThrow(ForbiddenError); // outro vendedor não mexe

    await cancelApproval(db, seller, quote.id); // quem pediu retira
    expect((await getQuote(db, quote.id)).aprovacaoStatus).toBe("nenhuma");

    await requestApproval(db, seller, quote.id, NOW);
    await expect(cancelApproval(db, admin, quote.id, " ")).rejects.toThrow(ValidationError); // devolver exige recado
    const back = await cancelApproval(db, admin, quote.id, "Faltou o frete");
    expect(back).toMatchObject({ aprovacaoStatus: "nenhuma", aprovacaoNota: "Faltou o frete" });
    await addServiceItem(db, seller, quote.id, { descricao: "Frete", quantidade: 1, precoUnitarioCentavos: 100 }); // edição liberada
  });

  it("refuses to approve when catalog costs changed after the request, until prices are refreshed", async () => {
    const { db, admin, seller, supplier, nb, quote } = await setup();
    await requestApproval(db, seller, quote.id, NOW);
    await addCostOffer(db, admin, { produtoId: nb.id, fornecedorId: supplier.id, custoCentavos: 80_000 }, LATER);

    await expect(approveQuote(db, admin, quote.id, {}, LATER)).rejects.toThrow(/custos do catálogo mudaram/);
    await repriceQuote(db, admin, quote.id, LATER); // o revisor atualiza mesmo com o orçamento travado
    expect((await approveQuote(db, admin, quote.id, {}, LATER)).aprovacaoStatus).toBe("aprovada");
  });

  it("a seller cannot refresh prices of a quote that is under review", async () => {
    const { db, seller, quote } = await setup();
    await requestApproval(db, seller, quote.id, NOW);
    await expect(repriceQuote(db, seller, quote.id, NOW)).rejects.toThrow(QuoteLockedError);
  });

  it("editing an approved quote invalidates the approval", async () => {
    const { db, admin, seller, quote } = await setup();
    await requestApproval(db, seller, quote.id, NOW);
    await approveQuote(db, admin, quote.id, {}, NOW);
    expect((await getQuote(db, quote.id)).aprovacaoStatus).toBe("aprovada");
    await addServiceItem(db, seller, quote.id, { descricao: "Instalação", quantidade: 1, precoUnitarioCentavos: 10_000 });
    expect(await getQuote(db, quote.id)).toMatchObject({ aprovacaoStatus: "nenhuma", aprovadoPor: null });
  });

  it("cannot request approval for an empty quote", async () => {
    const { db, seller, client } = await setup();
    const empty = await createQuote(db, seller, client.id, NOW);
    await expect(requestApproval(db, seller, empty.id, NOW)).rejects.toThrow(SendBlockedError);
  });
});

describe("approval required to send (setting)", () => {
  it("is off by default: a seller sends directly", async () => {
    const { db, seller, quote } = await setup();
    expect((await sendQuote(db, seller, quote.id, {}, NOW)).status).toBe("enviado");
  });

  it("when on, a seller is blocked until an admin approves; admins send directly", async () => {
    const { db, admin, seller, client, nb, quote } = await setup();
    await saveSettings(db, admin, { ...(await getSettings(db)), exigirAprovacaoInterna: true });

    await expect(sendQuote(db, seller, quote.id, {}, NOW)).rejects.toThrow(SendBlockedError);
    await requestApproval(db, seller, quote.id, NOW);
    await approveQuote(db, admin, quote.id, {}, NOW);
    expect((await sendQuote(db, seller, quote.id, {}, NOW)).status).toBe("enviado");

    const mine = await createQuote(db, admin, client.id, NOW);
    await addProductItem(db, admin, mine.id, nb.id, 1, NOW);
    expect((await sendQuote(db, admin, mine.id, {}, NOW)).status).toBe("enviado");
  });
});
