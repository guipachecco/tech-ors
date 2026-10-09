# Sistema de Orçamentos B2B — Plano de Implementação do MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o MVP local de orçamentos (catálogo com custo e validade, carrinho com cálculo de margem, exportação PDF e XLSX) com autenticação, perfis e auditoria.

**Architecture:** Monólito Next.js (App Router, TypeScript). Regras de preço e validade ficam em `src/domain` (funções puras, sem banco). Serviços em `src/server` fazem a autorização e falam com SQLite via Drizzle. Páginas em `src/app` só chamam serviços.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, SQLite (better-sqlite3) + Drizzle ORM, Zod, @node-rs/argon2, @react-pdf/renderer, exceljs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-orcamentos-mvp-design.md`

## Global Constraints

- Dinheiro sempre em **centavos inteiros** (`Cents`); percentuais em **pontos-base** (`Bps`, 1% = 100). Nunca ponto flutuante em valores monetários.
- Preço de venda = `custo / (1 − margem − impostos)`, arredondado **para cima** ao centavo; margem calculada sobre o preço de venda.
- Banco SQLite via Drizzle; **o arquivo do banco nunca fica dentro da pasta do projeto/OneDrive**. Padrão: `%LOCALAPPDATA%\TechMasterOrcamentos\orcamentos.db`, configurável por `DATABASE_PATH`.
- Toda entrada validada com Zod no servidor; consultas parametrizadas; autorização checada no servidor em cada ação.
- Senhas com argon2id. Sessão: token aleatório de 256 bits, só o hash no banco, cookie `HttpOnly`, `SameSite=Lax`, `Secure` quando houver HTTPS.
- Perfis: `administrador` e `vendedor`; permissão `pode_ver_custo`. Sem a permissão, custo e margem **não são enviados ao navegador**.
- Numeração de orçamento `AAAA-NNNN` (ex.: `2026-0001`), sequencial por ano, gerada em transação.
- Status: `em_elaboracao`, `enviado`, `aprovado`, `recusado`, `expirado`.
- Custo vencido bloqueia o envio; margem abaixo do mínimo e custo vencido só liberados por administrador, com justificativa na auditoria.
- Orçamento guarda custo, margem e preço **congelados** por item.
- XLSX: células de texto iniciadas por `=`, `+`, `-`, `@` recebem prefixo `'`. PDF e XLSX para o cliente **nunca** contêm custo ou margem.
- Segredos em `.env` (fora do Git); `.env.example` sem valores reais. **Sem IA no MVP.**
- Testes: Vitest para domínio e serviços; Playwright para o fluxo principal. Domínio é escrito test-first.
- Commits terminam com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Textos de interface em português do Brasil.

## Review Focus

1. **Entrada de valores** `1.234,56`, `R$ 1.234,56`, `1234.56`, `1.234`, vazio, `-5`, `abc`: aceitar os formatos inequívocos e rejeitar o resto (nunca virar R$ 0 em silêncio). → Task 2.
2. **Desconto de 100% ou preço líquido zero:** margem não pode virar `NaN`/divisão por zero e conta como abaixo do mínimo. → Task 2.
3. **Produto sem oferta de custo válida** adicionado ao carrinho: bloqueado com mensagem, nunca entra a R$ 0,00. → Task 9.
4. **Texto hostil** (nome de cliente ou produto com `=HYPERLINK(...)`, `<script>`, aspas, acentos) nos exports e nas telas. → Tasks 11 e 12.
5. **Envio duplo / clique duplo:** criar orçamento ou enviar duas vezes não gera dois números nem muda o status duas vezes. → Tasks 4, 11 e 12.

---

## Mapa de arquivos

```
src/domain/       money.ts  pricing.ts  costs.ts  quoteStatus.ts  quoteNumber.ts
src/server/config.ts
src/server/db/    schema.ts  client.ts   (migrações em drizzle/)
src/server/auth/  password.ts  sessions.ts  throttle.ts  permissions.ts  current.ts
src/server/audit.ts
src/server/catalog/  products.ts  offers.ts  margins.ts  suppliers.ts  settings.ts
src/server/clients.ts
src/server/quotes/   service.ts  views.ts  guard.ts
src/server/export/   xlsx.ts  pdf.tsx
src/app/          login, (app)/produtos, (app)/clientes, (app)/orcamentos, (app)/configuracoes
scripts/          create-admin.ts  backup.ts  restore-check.ts
tests/            domain/  server/  e2e/
assets/           logo (fornecido pelo usuário)
```

---

### Task 1: Projeto, Git e configuração

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/server/config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `tests/server/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: Record<string,string|undefined>): Config` com `Config = { databasePath: string; sessionSecret: string; isProduction: boolean }`. Falha com erro claro se `SESSION_SECRET` tiver menos de 32 caracteres.

- [ ] **Step 1:** `git init`; criar `.gitignore` com `.env`, `.env.local`, `data/`, `node_modules/`, `.next/`, `*.db`, `backups/`.
- [ ] **Step 2:** Criar o app Next.js (TypeScript, App Router, Tailwind, `src/`), fixar **versões exatas** no `package.json` e instalar as dependências listadas em Tech Stack. Scripts: `dev`, `build`, `start`, `test`, `db:generate`, `db:migrate`, `create-admin`, `backup`.
- [ ] **Step 3: Teste que falha** (`tests/server/config.test.ts`):
  - `loadConfig({SESSION_SECRET:'x'.repeat(31)})` lança erro.
  - `loadConfig({SESSION_SECRET:'x'.repeat(32), LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'}).databasePath` termina em `TechMasterOrcamentos\\orcamentos.db`.
  - `DATABASE_PATH` explícito prevalece.
- [ ] **Step 4:** Rodar `npx vitest run tests/server/config.test.ts`. Esperado: FAIL.
- [ ] **Step 5:** Implementar `loadConfig` (Zod). Criar `.env.example` com `SESSION_SECRET=` e `DATABASE_PATH=` vazios e comentados.
- [ ] **Step 6:** Rodar o teste. Esperado: PASS. Rodar `npm run build`. Esperado: sucesso.
- [ ] **Step 7:** Commit `chore: scaffold project and config`.

---

### Task 2: Domínio — dinheiro e preço

**Files:**
- Create: `src/domain/money.ts`, `src/domain/pricing.ts`
- Test: `tests/domain/money.test.ts`, `tests/domain/pricing.test.ts`

**Interfaces:**
- Produces (`money.ts`): `type Cents = number; type Bps = number; class InvalidMoneyError extends Error; parseBRL(input: string): Cents; formatBRL(c: Cents): string; formatBps(b: Bps): string` (ex.: `2000` → `"20,00%"`).
- Produces (`pricing.ts`): `salePriceCents(cost: Cents, marginBps: Bps, taxBps: Bps): Cents; lineNetCents(unit: Cents, qty: number, discountBps: Bps): Cents; lineMarginBps(costUnit: Cents, qty: number, netCents: Cents, taxBps: Bps): Bps | null; belowMinimum(marginBps: Bps | null, minBps: Bps): boolean`.

- [ ] **Step 1: Testes que falham.** Valores exatos:
  - `parseBRL`: `"1.234,56"`→`123456`; `"R$ 1.234,56"`→`123456`; `"1234,5"`→`123450`; `"1234.56"`→`123456`; `"1.234"`→`123400`; `"0,99"`→`99`. Lançam `InvalidMoneyError`: `""`, `"abc"`, `"-5"`, `"1,2,3"`, `"12,345"`.
  - `formatBRL(123456)` = `"R$\u00a01.234,56"`.
  - `salePriceCents(100000, 2000, 0)` = `125000`; `salePriceCents(100000, 2000, 1000)` = `142858`; `salePriceCents(0, 2000, 0)` = `0`.
  - `salePriceCents` lança `RangeError` se `marginBps + taxBps >= 10000`, custo negativo ou valor não inteiro.
  - `lineNetCents(125000, 3, 500)` = `356250`.
  - `lineMarginBps(100000, 1, 125000, 0)` = `2000`; `lineMarginBps(100000, 1, 0, 0)` = `null`.
  - `belowMinimum(null, 1000)` = `true`; `belowMinimum(999, 1000)` = `true`; `belowMinimum(1000, 1000)` = `false`.
- [ ] **Step 2:** Rodar `npx vitest run tests/domain`. Esperado: FAIL.
- [ ] **Step 3:** Implementar com aritmética inteira (`BigInt` para o produto intermediário em `salePriceCents`, evitando perda de precisão). `parseBRL`: ponto seguido de exatamente 3 dígitos é milhar; ponto com 1–2 dígitos finais e sem vírgula é decimal.
- [ ] **Step 4:** Rodar os testes. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(domain): money parsing and pricing`.

---

### Task 3: Domínio — custo vigente, status e numeração

**Files:**
- Create: `src/domain/costs.ts`, `src/domain/quoteStatus.ts`, `src/domain/quoteNumber.ts`
- Test: `tests/domain/costs.test.ts`, `tests/domain/quoteStatus.test.ts`, `tests/domain/quoteNumber.test.ts`

**Interfaces:**
- Produces: `type CostOffer = { id: number; supplierId: number; costCents: Cents; obtainedAt: Date; validUntil: Date }`; `isOfferValid(o: CostOffer, now: Date): boolean`; `currentCost(offers: CostOffer[], now: Date): CostOffer | null`; `defaultValidUntil(obtainedAt: Date, days: number): Date`.
- Produces: `type QuoteStatus = 'em_elaboracao'|'enviado'|'aprovado'|'recusado'|'expirado'`; `canTransition(from: QuoteStatus, to: QuoteStatus): boolean`.
- Produces: `formatQuoteNumber(year: number, seq: number): string`.

- [ ] **Step 1: Testes que falham:**
  - `currentCost`: ofertas A (5000, válida), B (4000, vencida), C (4500, válida) → C; nenhuma válida → `null`; empate de custo → a de `obtainedAt` mais recente. Vencimento exatamente em `now` conta como vencida.
  - `defaultValidUntil(new Date('2026-10-09T12:00:00Z'), 7)` = `2026-10-16T12:00:00Z`.
  - `canTransition`: `em_elaboracao→enviado` true; `enviado→aprovado|recusado|expirado` true; `aprovado→enviado` false; `em_elaboracao→aprovado` false; qualquer estado → ele mesmo false.
  - `formatQuoteNumber(2026, 1)` = `"2026-0001"`; `(2026, 12345)` = `"2026-12345"`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar as funções puras.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(domain): cost validity, status, numbering`.

---

### Task 4: Banco de dados e migrações

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/client.ts`, `drizzle.config.ts`, `tests/server/helpers/testDb.ts`
- Test: `tests/server/db.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 1).
- Produces: `getDb(): Db` (singleton, `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, cria a pasta do banco se faltar); `createTestDb(): Db` (SQLite em memória, migrações aplicadas); tabelas do Drizzle com os nomes do spec: `usuarios`, `sessoes`, `fornecedores`, `produtos`, `ofertasCusto`, `regrasMargem`, `configuracao`, `clientes`, `orcamentos`, `orcamentoItens`, `auditoria`, `sequenciaOrcamento`.
- `regrasMargem` inclui `validadeCustoDias` (opcional), usado para pré-preencher a validade do custo por categoria/fabricante (ex.: SSD e memória com validade menor que o padrão).
- `produtos` inclui a coluna `busca` (texto normalizado: minúsculas, sem acento). `orcamentos.numero` tem índice **único**. `orcamentoItens` guarda: `tipo` (`produto|servico`), `descricao`, `quantidade`, `custoCentavos`, `margemBps`, `impostosBps`, `precoUnitarioCentavos`, `descontoBps`, `custoValidoAte`, `ofertaCustoId`. `orcamentos` guarda `freteCentavos`.

- [ ] **Step 1: Teste que falha:** com `createTestDb()`, inserir dois orçamentos com o mesmo `numero` lança erro de unicidade; excluir um fornecedor com ofertas lança erro de chave estrangeira.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Escrever o schema, gerar a migração (`npm run db:generate`) e versioná-la em `drizzle/`.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(db): schema and migrations`.

---

### Task 5: Autenticação — senha, sessão e limite de tentativas

**Files:**
- Create: `src/server/auth/password.ts`, `src/server/auth/sessions.ts`, `src/server/auth/throttle.ts`
- Test: `tests/server/auth.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`; `verifyPassword(hash: string, plain: string): Promise<boolean>`; `validatePasswordStrength(plain: string): void` (lança se < 10 caracteres).
- Produces: `type SessionUser = { id: number; nome: string; email: string; perfil: 'administrador'|'vendedor'; podeVerCusto: boolean }`; `createSession(db: Db, userId: number, now?: Date): Promise<{ token: string; expiresAt: Date }>` (validade de 12 h); `validateSession(db: Db, token: string, now?: Date): Promise<SessionUser | null>`; `revokeSession(db: Db, token: string): Promise<void>`.
- Produces: `checkLoginAllowed(key: string, now?: Date): { allowed: boolean; retryAfterSec: number }`; `recordLoginFailure(key: string, now?: Date): void`; `clearLoginFailures(key: string): void`. Em memória; limite de 5 falhas em 15 min por chave (use `email` e `ip` como chaves separadas); bloqueio de 15 min.

- [ ] **Step 1: Testes que falham:**
  - `hashPassword` produz hash começando com `$argon2id$`; `verifyPassword` aceita a senha certa e rejeita a errada.
  - `validatePasswordStrength('curta')` lança.
  - Sessão: o token tem 43+ caracteres; o banco **não** contém o token em texto (só o hash SHA-256); `validateSession` com o token retorna o usuário; após `revokeSession` ou após 12 h retorna `null`; usuário inativo retorna `null`.
  - Throttle: 5 falhas → `allowed:false`, `retryAfterSec > 0`; passados 15 min → `allowed:true`; `clearLoginFailures` zera.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar (`@node-rs/argon2`, `crypto.randomBytes(32)`, SHA-256).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(auth): passwords, sessions, throttle`.

---

### Task 6: Autorização, auditoria e administrador inicial

**Files:**
- Create: `src/server/auth/permissions.ts`, `src/server/auth/current.ts`, `src/server/audit.ts`, `scripts/create-admin.ts`
- Test: `tests/server/permissions.test.ts`, `tests/server/audit.test.ts`

**Interfaces:**
- Produces: `type Action = 'cost:view'|'cost:write'|'margin:manage'|'quote:override'|'user:manage'|'settings:manage'`; `can(user: SessionUser, action: Action): boolean`.
  - Administrador: todas. Vendedor: só `cost:view`/`cost:write` se `podeVerCusto` for verdadeiro; nunca as demais.
- Produces: `requireUser(): Promise<SessionUser>` (lê o cookie de sessão, redireciona para `/login`); `requireCan(action: Action): Promise<SessionUser>` (lança `ForbiddenError`).
- Produces: `recordAudit(db: Db, e: { userId: number | null; acao: string; entidade: string; entidadeId?: number; antes?: unknown; depois?: unknown }): void`.
- `scripts/create-admin.ts`: pede e-mail e senha no terminal com a senha **oculta** (não aceita senha por argumento), valida a força e cria o administrador com `podeVerCusto = true`.

- [ ] **Step 1: Testes que falham:** matriz de `can` para os dois perfis, com e sem `podeVerCusto`; `recordAudit` grava `antes`/`depois` como JSON e não grava campos chamados `senhaHash`/`token`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar. `recordAudit` remove chaves sensíveis antes de gravar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(auth): permissions, audit, admin script`.

---

### Task 7: Login, proteção de rotas e layout

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/middleware.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `tests/e2e/login.spec.ts`

**Interfaces:**
- Consumes: Tasks 5 e 6.
- Produces: ação `login(formData)` (valida com Zod, e-mail comparado em minúsculas, limita por e-mail e por IP, resposta **genérica** "E-mail ou senha inválidos" para usuário inexistente e senha errada, cria sessão e define o cookie, registra auditoria); ação `logout()` (revoga a sessão e limpa o cookie). Middleware: sem cookie → `/login` para qualquer rota fora de `/login`; em requisições que não sejam GET, rejeita se `Origin` não for o host do app.

- [ ] **Step 1: Teste e2e que falha** (`login.spec.ts`): acessar `/` sem login redireciona para `/login`; senha errada mostra a mensagem genérica; 6 tentativas erradas mostram bloqueio; login válido chega à página inicial; após sair, `/` volta a redirecionar.
- [ ] **Step 2:** Rodar `npx playwright test tests/e2e/login.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar a tela, as ações e o middleware. Cabeçalhos de segurança em `next.config.ts` (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, CSP restritiva).
- [ ] **Step 4:** Rodar o e2e. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(auth): login, route protection, security headers`.

---

### Task 8: Serviço do catálogo (fornecedores, produtos, ofertas, regras, configuração)

**Files:**
- Create: `src/server/catalog/{suppliers,products,offers,margins,settings}.ts`
- Test: `tests/server/catalog.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 6.
- Produces:
  - `createSupplier / updateSupplier(db, user, input)`.
  - `createProduct(db, user, input: ProductInput): Product`; `updateProduct`; `searchProducts(db, user, query: string, limit?: number): ProductView[]`. A busca ignora acentos e maiúsculas e exige todos os termos (`"nobreak 1500va"` encontra `"Nobreak SMS 1500VA"`). Normalização compartilhada em `normalizeSearch(text: string): string`.
  - `addCostOffer(db, user, input: { productId; supplierId; skuFornecedor?; urlProduto?; custoCentavos: Cents; observacao?; obtidoEm?: Date; validoAte?: Date }): CostOffer`. Exige `cost:write`; se `validoAte` faltar, usa `defaultValidUntil` com a validade da regra da categoria ou da configuração. Cada chamada **cria nova linha** (histórico).
  - `getMarginRule(db, product): { marginBps; minMarginBps }` (fabricante, depois categoria, depois padrão).
  - `ProductView = { id; sku; fabricante; modelo; categoria; descricao; precoVendaCentavos: Cents | null; statusCusto: 'valido'|'vencido'|'sem_preco'; custo?: {...}; margemBps?: Bps }`. Os campos `custo` e `margemBps` **só existem** quando `can(user,'cost:view')`.
  - `getSettings / saveSettings` (validade padrão de custo em dias = 7, validade da proposta = 15 dias, impostos em Bps, dados da empresa, textos padrão).
- Auditoria: criar/alterar produto, oferta, regra e configuração chamam `recordAudit`.

- [ ] **Step 1: Testes que falham:**
  - A busca é case/acento-insensível e exige todos os termos.
  - `addCostOffer` sem permissão lança `ForbiddenError`; com permissão, duas chamadas geram duas linhas e `precoVendaCentavos` usa a mais barata válida.
  - Produto só com oferta vencida: `statusCusto = 'vencido'`; sem ofertas: `'sem_preco'`; em ambos `precoVendaCentavos` é `null`.
  - Para vendedor sem `podeVerCusto`, o objeto retornado **não tem** as chaves `custo` nem `margemBps` (`'custo' in view === false`).
  - Regra por fabricante vence a da categoria; sem regra usa o padrão da configuração.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar usando as funções de domínio.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(catalog): products, offers, margin rules, settings`.

---

### Task 9: Telas do catálogo

**Files:**
- Create: `src/app/(app)/produtos/{page,novo/page,[id]/page,actions}.tsx|ts`, `src/app/(app)/fornecedores/…`, `src/app/(app)/configuracoes/page.tsx`, `tests/e2e/catalog.spec.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces: lista de produtos com busca e selo de custo (verde válido, vermelho vencido, cinza sem preço, mostrando "há N dias"); formulário de produto; na página do produto, formulário "Atualizar custo" com campo de valor (usa `parseBRL`), link do fornecedor clicável (somente `http/https`, `rel="noopener noreferrer"`), validade pré-preenchida e editável; histórico de custos (só com permissão); telas de fornecedores, regras de margem e configurações (só administrador).

- [ ] **Step 1: Teste e2e que falha:** o administrador cadastra fornecedor e produto e atualiza o custo com `1.234,56`; a lista mostra o selo verde; um vendedor sem permissão não vê custo, histórico nem margem na página; link com `javascript:alert(1)` é recusado no formulário.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar as páginas e ações (Zod em cada ação; mensagens de erro por campo).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(ui): catalog screens`.

---

### Task 10: Clientes

**Files:**
- Create: `src/server/clients.ts`, `src/app/(app)/clientes/…`
- Test: `tests/server/clients.test.ts`

**Interfaces:**
- Produces: `createClient / updateClient / searchClients(db, user, query)`; campos: razão social, CNPJ (opcional; se informado, validar os dígitos verificadores), contato, e-mail, telefone. Auditoria nas alterações.

- [ ] **Step 1: Testes que falham:** CNPJ com dígito verificador inválido é rejeitado; `11.222.333/0001-81` é aceito; busca por parte do nome ignora acentos.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar serviço e telas de lista e formulário.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(clients): client registry`.

---

### Task 11: Serviço de orçamentos

**Files:**
- Create: `src/server/quotes/service.ts`, `src/server/quotes/guard.ts`, `src/server/quotes/views.ts`
- Test: `tests/server/quotes.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6, 8, 10.
- Produces:
  - `createQuote(db, user, clientId: number, now?: Date): Quote` — gera o número com `sequenciaOrcamento` em transação (`2026-0001`).
  - `addProductItem(db, user, quoteId, productId, qty: number): QuoteItem` — lança `NoValidCostError` se não houver custo válido; congela custo, margem, impostos, preço e validade do custo.
  - `addServiceItem(db, user, quoteId, { descricao; qty; precoUnitarioCentavos })`; `setFrete(db, user, quoteId, cents)`; `updateItem(db, user, itemId, { qty?; descontoBps? })`; `removeItem`.
  - `repriceItem(db, user, itemId)` — traz custo e preço vigentes do catálogo.
  - `quoteTotals(quote): { subtotalCentavos; descontoCentavos; freteCentavos; totalCentavos }`.
  - `checkSendable(quote, items, user, now): { ok: true } | { ok: false; motivos: Array<'sem_itens'|'sem_cliente'|'custo_vencido'|'margem_abaixo_minimo'> }` (em `guard.ts`).
  - `sendQuote(db, user, quoteId, opts?: { justificativa?: string }, now?: Date)` — só altera de `em_elaboracao` para `enviado`; `custo_vencido` e `margem_abaixo_minimo` só são liberados se `can(user,'quote:override')` e houver justificativa (gravada na auditoria); `sem_itens`/`sem_cliente` nunca.
  - `setOutcome(db, user, quoteId, 'aprovado'|'recusado', motivo?)`; `duplicateQuote(db, user, quoteId)`; `quoteDrift(db, quoteId): Array<{ itemId; custoAtualCentavos: Cents | null; custoCongeladoCentavos: Cents }>` (somente para quem tem `cost:view`); `expireOverdueQuotes(db, now): number`.
  - `toClientView(quote, items, company): QuoteClientView` (em `views.ts`) — tipo **sem** nenhum campo de custo ou margem.
- Itens de serviço e frete ficam fora da checagem de margem mínima.
- Orçamento só é editável em `em_elaboracao`.

- [ ] **Step 1: Testes que falham:**
  - Dois `createQuote` seguidos em 2026 geram `2026-0001` e `2026-0002`; em 2027 reinicia em `2027-0001`.
  - `addProductItem` copia custo, margem e preço; alterar o custo no catálogo depois **não** muda o item.
  - Produto sem oferta válida → `NoValidCostError`, nenhum item criado.
  - `quoteTotals`: 3 un. a `125000` com 5% de desconto + frete `5000` → total `361250`.
  - `checkSendable`: custo congelado vencido → `custo_vencido`; desconto de 100% → `margem_abaixo_minimo`.
  - Vendedor tenta enviar com motivo → erro; administrador sem justificativa → erro; com justificativa → envia e a auditoria registra o motivo.
  - Chamar `sendQuote` duas vezes: a segunda lança erro e a auditoria tem uma única entrada de envio.
  - `duplicateQuote` copia itens e cria novo número em `em_elaboracao`.
  - `expireOverdueQuotes` muda só os `enviado` com validade vencida.
  - `toClientView(...)` não contém, em nenhum nível do objeto, as chaves `custo*` ou `margem*` (percorrer recursivamente).
  - Editar item de orçamento `enviado` lança erro.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar. Transações do Drizzle para numeração, envio e duplicação.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(quotes): quote service with frozen pricing and send guard`.

---

### Task 12: Telas do orçamento (carrinho)

**Files:**
- Create: `src/app/(app)/orcamentos/{page,novo/page,[id]/page,actions}.tsx|ts`, `tests/e2e/quote.spec.ts`

**Interfaces:**
- Consumes: Task 11.
- Produces: lista de orçamentos (número, cliente, status, total, data; chama `expireOverdueQuotes` ao carregar); tela do orçamento com busca de produtos por digitação (adiciona com Enter), tabela editável de itens (quantidade, desconto), linhas de serviço, campo de frete, totais, alertas por item (custo vencido, sem preço, margem baixa — esta só para quem vê margem), botões: Enviar, Duplicar, Aprovar, Recusar, PDF, XLSX; diálogo de justificativa para o administrador liberar o envio. Texto de cliente/produto renderizado como texto (sem HTML bruto).

- [ ] **Step 1: Teste e2e que falha:** fluxo completo — criar orçamento para um cliente, buscar "nobreak", adicionar, mudar a quantidade para 3, aplicar 5% de desconto, definir frete, ver o total; item sem custo válido mostra aviso e não entra; cliente chamado `<img src=x onerror=alert(1)>` aparece como texto e nenhum alerta dispara; clique duplo em "Enviar" resulta em um único envio.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar. Botões de ação desabilitam durante o envio.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(ui): quote cart screens`.

---

### Task 13: Exportação XLSX

**Files:**
- Create: `src/server/export/xlsx.ts`, `src/app/(app)/orcamentos/[id]/xlsx/route.ts`
- Test: `tests/server/xlsx.test.ts`

**Interfaces:**
- Consumes: `QuoteClientView` (Task 11).
- Produces: `neutralizeFormula(text: string): string`; `buildQuoteXlsx(view: QuoteClientView): Promise<Buffer>`; rota `GET` autenticada que devolve o arquivo com `Content-Disposition` seguro (`orcamento-2026-0001.xlsx`) e registra a exportação na auditoria. A exportação não altera o status.

- [ ] **Step 1: Testes que falham:** `neutralizeFormula('=1+1')`=`"'=1+1"`; idem para `+`, `-`, `@`, e para texto que começa com tab; `'texto'` normal fica igual. O workbook gerado, lido de volta, tem na primeira aba cabeçalho do cliente, itens com descrição/quantidade/unitário/total e totais; um item chamado `=HYPERLINK("http://x","y")` aparece como texto neutralizado; **nenhuma célula** contém as palavras "custo" ou "margem".
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar com `exceljs`; valores monetários como número com formato `R$`.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(export): xlsx quote export`.

---

### Task 14: Exportação PDF com a arte da empresa

**Files:**
- Create: `src/server/export/pdf.tsx`, `src/app/(app)/orcamentos/[id]/pdf/route.ts`, `assets/` (logo fornecido)
- Test: `tests/server/pdf.test.ts`

**Interfaces:**
- Consumes: `QuoteClientView`, `Settings` (Task 8).
- Produces: `buildQuotePdf(view: QuoteClientView, opts: { logoPath?: string }): Promise<Buffer>`; rota `GET` autenticada, igual à do XLSX. Conteúdo: logo, dados da empresa, número, data, validade, dados do cliente, tabela de itens, totais, condições de pagamento, prazo, garantia e observações (textos padrão da configuração, editáveis no orçamento).

- [ ] **Step 1: Receber a arte.** Se `assets/` ainda estiver vazio, usar um modelo provisório sem logo e pedir o arquivo ao usuário antes do fechamento do marco.
- [ ] **Step 2: Testes que falham:** `buildQuotePdf` devolve um buffer que começa com `%PDF-`; funciona com 1 item e com 60 itens (várias páginas); funciona com nome de cliente com acentos e com `<b>x</b>`; sem logo não falha; o texto extraído do PDF não contém "custo" nem "margem".
- [ ] **Step 3:** Rodar. Esperado: FAIL.
- [ ] **Step 4:** Implementar com `@react-pdf/renderer`; cabeçalho da tabela repetido em cada página.
- [ ] **Step 5:** Rodar. Esperado: PASS. Gerar um PDF de exemplo e conferir visualmente com o usuário.
- [ ] **Step 6:** Commit `feat(export): pdf quote export`.

---

### Task 15: Backup e restauração

**Files:**
- Create: `scripts/backup.ts`, `scripts/restore-check.ts`, `docs/operacao.md`
- Test: `tests/server/backup.test.ts`

**Interfaces:**
- Produces: `runBackup(db: Db, destDir: string, now?: Date, keepDays?: number): Promise<string>` (usa a API de backup do SQLite para cópia consistente; nome `orcamentos-AAAA-MM-DD.db`; apaga cópias com mais de 30 dias); `checkBackup(path: string): { ok: boolean; tables: number; integrity: string }`.
- `docs/operacao.md`: como agendar o backup diário no Agendador de Tarefas do Windows (destino fora do OneDrive e uma cópia secundária), como restaurar, como trocar a senha do administrador.

- [ ] **Step 1: Testes que falham:** o backup é criado com o nome esperado; `checkBackup` retorna `ok:true` e `integrity:'ok'`; backups com 31 dias são removidos e com 29 dias permanecem.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS. Executar uma restauração real em pasta temporária e conferir.
- [ ] **Step 5:** Commit `feat(ops): backup and restore check`.

---

### Task 16: Endurecimento e guia de uso

**Files:**
- Create: `docs/guia-de-uso.md`, `tests/e2e/security.spec.ts`
- Modify: itens encontrados na revisão

**Interfaces:**
- Consumes: todo o sistema.

- [ ] **Step 1: Testes e2e de segurança:** vendedor sem permissão recebe 403/redirecionamento ao tentar abrir telas de configuração e usuários; a resposta HTML e o JSON da página do produto para esse vendedor não contêm o valor do custo (buscar o número no corpo da resposta); `POST` com `Origin` de outro site é rejeitado; rota de PDF/XLSX sem login redireciona.
- [ ] **Step 2:** Rodar toda a suíte: `npm test` e `npx playwright test`. Esperado: tudo PASS.
- [ ] **Step 3:** Rodar `npm audit` e tratar vulnerabilidades altas ou críticas.
- [ ] **Step 4:** Rodar a revisão de segurança (`/security-review`) e corrigir o que for confirmado.
- [ ] **Step 5:** Refazer 3–5 orçamentos reais no sistema e comparar o total com o valor praticado; anotar diferenças.
- [ ] **Step 6:** Escrever `docs/guia-de-uso.md` (como atualizar custo, montar e exportar um orçamento, o que significam os alertas).
- [ ] **Step 7:** Commit `chore: hardening and user guide`.

---

## Marco opcional (fora deste plano)

**M6 — IA no cadastro** (colar texto do fornecedor, conferir antes de salvar). Só será planejado se o usuário decidir ativá-lo.
