// Dados de demonstração para DESENVOLVIMENTO. Só roda com DATABASE_PATH explícito (nunca no banco padrão)
// e apenas em banco vazio. Credenciais abaixo valem somente para esse banco de teste.
import { hashPassword } from "../src/server/auth/password";
import type { SessionUser } from "../src/server/auth/sessions";
import { addCostOffer } from "../src/server/catalog/offers";
import { saveMarginRule } from "../src/server/catalog/margins";
import { saveProduct } from "../src/server/catalog/products";
import { getSettings, saveSettings } from "../src/server/catalog/settings";
import { saveSupplier } from "../src/server/catalog/suppliers";
import { saveClient } from "../src/server/clients";
import { getDb } from "../src/server/db/client";
import { usuarios } from "../src/server/db/schema";

const DEV_PASSWORD = "dev-senha-12345";

async function main() {
  if (!process.env.DATABASE_PATH) throw new Error("Defina DATABASE_PATH para um banco de teste antes de rodar o seed.");
  const db = getDb();
  if (db.select().from(usuarios).all().length > 0) throw new Error("O banco já tem usuários; seed cancelado.");

  const hash = await hashPassword(DEV_PASSWORD);
  const admin = db.insert(usuarios).values({ nome: "Admin Teste", email: "admin@teste.local", senhaHash: hash, perfil: "administrador", podeVerCusto: true }).returning().get();
  db.insert(usuarios).values({ nome: "Vendedor Teste", email: "vendedor@teste.local", senhaHash: hash, perfil: "vendedor", podeVerCusto: false }).run();
  const actor: SessionUser = { id: admin.id, nome: admin.nome, email: admin.email, perfil: "administrador", podeVerCusto: true };

  saveSettings(db, actor, { ...getSettings(db), empresaNome: "Tech Master Informática", empresaTelefone: "(11) 5555-0000", empresaEmail: "vendas@techmaster.test", impostosBps: 800 });
  saveMarginRule(db, actor, { escopo: "categoria", chave: "SSD", margemBps: 1800, margemMinimaBps: 800, validadeCustoDias: 3 });
  saveMarginRule(db, actor, { escopo: "categoria", chave: "Memória", margemBps: 1800, margemMinimaBps: 800, validadeCustoDias: 3 });
  saveMarginRule(db, actor, { escopo: "fabricante", chave: "Sophos", margemBps: 1500, margemMinimaBps: 1000 });

  const f1 = saveSupplier(db, actor, { nome: "Distribuidora Alfa", site: "https://alfa.example.com" });
  const f2 = saveSupplier(db, actor, { nome: "Distribuidora Beta", site: "https://beta.example.com" });

  const products = [
    { sku: "NB-SMS-1500", fabricante: "SMS", modelo: "Manager III 1500VA", categoria: "Nobreak", descricao: "Nobreak senoidal 1500VA bivolt", custo: 142000 },
    { sku: "SW-TPL-24P", fabricante: "TP-Link", modelo: "TL-SG1024PE", categoria: "Switch", descricao: "Switch gerenciável 24 portas Gigabit, 12 PoE+", custo: 189000 },
    { sku: "SSD-KNG-1T", fabricante: "Kingston", modelo: "NV2 1TB NVMe", categoria: "SSD", descricao: "SSD M.2 NVMe 1TB", custo: 38000 },
    { sku: "MEM-KNG-16", fabricante: "Kingston", modelo: "Fury 16GB DDR4 3200", categoria: "Memória", descricao: "Memória DDR4 16GB 3200MHz", custo: 21000 },
    { sku: "FW-SOP-XGS107", fabricante: "Sophos", modelo: "XGS 107", categoria: "Firewall", descricao: "Firewall Sophos XGS 107 (hardware)", custo: 520000 },
    { sku: "LIC-SOP-107-3A", fabricante: "Sophos", modelo: "XGS 107 Protection 3 anos", categoria: "Licença", descricao: "Licença Xstream Protection 36 meses", custo: 410000 },
    { sku: "NTB-DEL-5440", fabricante: "Dell", modelo: "Latitude 5440 i5 16GB", categoria: "Notebook", descricao: "Notebook Dell Latitude 5440, i5, 16GB, 512GB SSD", custo: 520000 },
    { sku: "MON-LG-24", fabricante: "LG", modelo: "24MR400", categoria: "Monitor", descricao: "Monitor 24'' IPS Full HD", custo: 62000 },
  ];
  for (const p of products) {
    const row = saveProduct(db, actor, p);
    if (p.sku !== "MON-LG-24") {
      addCostOffer(db, actor, { produtoId: row.id, fornecedorId: p.categoria === "Switch" ? f2.id : f1.id, custoCentavos: p.custo, urlProduto: "https://alfa.example.com/produto" });
    }
  }
  saveClient(db, actor, { razaoSocial: "Indústria São João Ltda", cnpj: "11.222.333/0001-81", contato: "Ana Souza", email: "ana@saojoao.test" });
  saveClient(db, actor, { razaoSocial: "Clínica Vida Plena", contato: "Dr. Paulo" });
  console.log("Seed concluído. Usuários: admin@teste.local e vendedor@teste.local (senha no arquivo scripts/dev-seed.ts).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
