import fs from "node:fs";
import path from "node:path";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatCnpj } from "../../domain/cnpj";
import { formatDate } from "../../domain/format";
import { formatBRL, formatBps } from "../../domain/money";
import type { QuoteClientView } from "../quotes/views";

const BRAND = "#6d609e"; // Pantone 265 C (manual de marca TechMaster)
const MUTED = "#6b7280";

const s = StyleSheet.create({
  page: { padding: 36, paddingBottom: 56, fontSize: 9.5, fontFamily: "Helvetica", color: "#111827" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logo: { width: 92, height: 82, objectFit: "contain", marginBottom: 4 },
  company: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#374151" },
  small: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  titleBox: { alignItems: "flex-end" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: BRAND },
  box: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 4, padding: 10, marginBottom: 14 },
  boxLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 3 },
  bold: { fontFamily: "Helvetica-Bold" },
  tHead: { flexDirection: "row", backgroundColor: BRAND, color: "#ffffff", paddingVertical: 5, paddingHorizontal: 4 },
  tRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  cN: { width: "6%" },
  cDesc: { width: "46%" },
  cQty: { width: "8%", textAlign: "right" },
  cUnit: { width: "16%", textAlign: "right" },
  cDisc: { width: "8%", textAlign: "right" },
  cTotal: { width: "16%", textAlign: "right" },
  totals: { alignSelf: "flex-end", width: "46%", marginTop: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grandTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, marginTop: 3, borderTopWidth: 1, borderTopColor: BRAND },
  grandText: { fontSize: 12, fontFamily: "Helvetica-Bold", color: BRAND },
  terms: { marginTop: 18 },
  termRow: { flexDirection: "row", marginBottom: 3 },
  termLabel: { width: "24%", fontFamily: "Helvetica-Bold" },
  termValue: { width: "76%" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: MUTED },
});

export function findLogo(dir = path.join(process.cwd(), "assets")): string | undefined {
  for (const name of ["logo.png", "logo.jpg", "logo.jpeg"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

type LogoSrc = { data: Buffer; format: "png" | "jpg" };

// Passa a imagem como dados: caminhos do Windows (C:...) são confundidos com URL pelo react-pdf.
function readLogo(logoPath?: string): LogoSrc | undefined {
  if (!logoPath) return undefined;
  return { data: fs.readFileSync(logoPath), format: /\.png$/i.test(logoPath) ? "png" : "jpg" };
}

function QuotePdf({ view, logo }: { view: QuoteClientView; logo?: LogoSrc }) {
  const e = view.empresa;
  const c = view.cliente;
  const hasDiscount = view.itens.some((i) => i.descontoBps > 0);
  return (
    <Document title={`Orçamento ${view.numero}`} author={e.nome}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            {logo ? <Image src={logo} style={s.logo} /> : <Text style={s.company}>{e.nome}</Text>}
            {logo && <Text style={s.company}>{e.nome}</Text>}
            {e.cnpj ? <Text style={s.small}>CNPJ {e.cnpj}</Text> : null}
            {e.endereco ? <Text style={s.small}>{e.endereco}</Text> : null}
            <Text style={s.small}>{[e.telefone, e.email].filter(Boolean).join("  ·  ")}</Text>
          </View>
          <View style={s.titleBox}>
            <Text style={s.title}>Orçamento {view.numero}</Text>
            <Text style={s.small}>Emissão: {formatDate(view.emitidoEm)}</Text>
            <Text style={s.small}>Válido até: {formatDate(view.validoAte)}</Text>
          </View>
        </View>

        <View style={s.box}>
          <Text style={s.boxLabel}>Cliente</Text>
          <Text style={s.bold}>{c.razaoSocial}</Text>
          {c.cnpj ? <Text>CNPJ {formatCnpj(c.cnpj)}</Text> : null}
          {c.contato ? <Text>A/C: {c.contato}</Text> : null}
          <Text>{[c.email, c.telefone].filter(Boolean).join("  ·  ")}</Text>
        </View>

        <View style={s.tHead} fixed>
          <Text style={s.cN}>#</Text>
          <Text style={s.cDesc}>Descrição</Text>
          <Text style={s.cQty}>Qtd</Text>
          <Text style={s.cUnit}>Unitário</Text>
          <Text style={s.cDisc}>{hasDiscount ? "Desc." : ""}</Text>
          <Text style={s.cTotal}>Total</Text>
        </View>
        {view.itens.map((it, i) => (
          <View key={i} style={s.tRow} wrap={false}>
            <Text style={s.cN}>{i + 1}</Text>
            <Text style={s.cDesc}>{it.descricao}</Text>
            <Text style={s.cQty}>{it.quantidade}</Text>
            <Text style={s.cUnit}>{formatBRL(it.precoUnitarioCentavos)}</Text>
            <Text style={s.cDisc}>{it.descontoBps > 0 ? formatBps(it.descontoBps) : ""}</Text>
            <Text style={s.cTotal}>{formatBRL(it.totalCentavos)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{formatBRL(view.subtotalCentavos)}</Text>
          </View>
          {view.descontoCentavos > 0 && (
            <View style={s.totalRow}>
              <Text>Descontos</Text>
              <Text>-{formatBRL(view.descontoCentavos)}</Text>
            </View>
          )}
          {view.freteCentavos > 0 && (
            <View style={s.totalRow}>
              <Text>Frete</Text>
              <Text>{formatBRL(view.freteCentavos)}</Text>
            </View>
          )}
          <View style={s.grandTotal}>
            <Text style={s.grandText}>TOTAL</Text>
            <Text style={s.grandText}>{formatBRL(view.totalCentavos)}</Text>
          </View>
        </View>

        <View style={s.terms} wrap={false}>
          {[
            ["Pagamento", view.condicoesPagamento],
            ["Prazo de entrega", view.prazoEntrega],
            ["Garantia", view.garantia],
            ["Observações", view.observacoes],
          ]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <View key={label} style={s.termRow}>
                <Text style={s.termLabel}>{label}</Text>
                <Text style={s.termValue}>{value}</Text>
              </View>
            ))}
        </View>

        <View style={s.footer} fixed>
          <Text>{e.nome}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function buildQuotePdf(view: QuoteClientView, opts: { logoPath?: string } = {}): Promise<Buffer> {
  return renderToBuffer(<QuotePdf view={view} logo={readLogo(opts.logoPath)} />);
}
