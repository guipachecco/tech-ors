# Sistema de Orçamentos B2B — Especificação do MVP

Data: 2026-10-09 · Status: **aguardando revisão**

## 1. Objetivo e contexto

Reduzir o tempo e os erros na elaboração de orçamentos de equipamentos de TI (nobreaks, redes, servidores, desktops/notebooks, Sophos, periféricos, licenças).

**Fatos informados pelo usuário**
- Desenvolvimento por duas pessoas: o usuário e o Claude.
- Escala pequena: centenas de produtos e de orçamentos.
- Os preços de custo vêm de **sites de fornecedores, sem exportação nem API**. Hoje são consultados manualmente.
- Os preços mudam **toda semana** (principalmente SSD e memória).
- A arte da empresa (logotipo e modelo visual) já existe e será fornecida.
- Fluxo desejado: cadastrar o item (modelo, preço e demais dados), colocá-lo no "carrinho" e exportar o orçamento em **PDF ou XLSX**.

**Premissas (a confirmar na revisão)**
- P1. O orçamento mostra **preço final** ao cliente. Impostos ficam embutidos num percentual configurável, sem discriminação fiscal. Discriminar ICMS/ST fica para versão futura.
- P2. Execução **local primeiro** (uma máquina ou servidor do escritório, acessível pela rede interna), com migração para nuvem possível depois.
- P3. **Sem IA no MVP** (decisão do usuário). A seção de segurança sobre IA e a dependência da API só valem se o M6 opcional for ativado.
- P4. Moeda única: BRL. Preços em dólar são convertidos manualmente na hora do cadastro (campo de observação).

**Critério de sucesso:** um orçamento típico (5–15 itens) sai em menos da metade do tempo atual, com margem calculada corretamente e nenhum item com custo vencido sem aviso.

## 2. Escopo

**Entra no MVP**
1. Login, perfis e auditoria.
2. Cadastro de fornecedores, produtos e **ofertas de custo** (custo, fornecedor, link da página, data, validade).
3. Alerta e bloqueio por custo vencido.
4. Regras de margem (por categoria e por fabricante, com margem mínima).
5. Cadastro de clientes.
6. Orçamento (carrinho): busca, quantidade, margem, desconto, frete e serviços, com cálculo automático.
7. Congelamento (snapshot) de custo, margem e preço no orçamento.
8. Numeração automática, status (em elaboração, enviado, aprovado, recusado, expirado), duplicar orçamento.
9. Exportar **PDF** (arte da empresa) e **XLSX**.
(A IA no cadastro foi retirada do MVP por decisão do usuário; ver M6 opcional.)

**Fora do MVP:** integração com ERP/e-mail, captura automática de preços dos sites, compatibilidade técnica, portal do cliente, discriminação fiscal, conversão em pedido, múltiplas moedas.

## 3. Arquitetura

**Monólito simples e modular**, em TypeScript.

| Camada | Escolha | Motivo |
|---|---|---|
| App web | Next.js (App Router) + React | Uma base de código para UI e servidor |
| Banco | SQLite (arquivo) via Drizzle ORM | Suficiente para centenas de registros, sem servidor para administrar; consultas parametrizadas; migrações versionadas |
| Validação | Zod | Toda entrada é validada no servidor |
| Autenticação | Senha com argon2id + sessão em banco (cookie HttpOnly) | Sem dependência de serviço externo |
| PDF | @react-pdf/renderer | Sem navegador embutido; layout com a arte da empresa |
| XLSX | exceljs | Geração no servidor |
| IA | API da Anthropic, só no servidor | Chave nunca vai ao navegador |
| Testes | Vitest (domínio) + Playwright (fluxo principal) | Cálculo de preço é crítico |

**Organização do código**
```
src/
  domain/      regras puras, sem banco nem rede (preço, margem, validade)
  server/      banco, autenticação, serviços, auditoria, exportação, IA
  app/         páginas e ações do servidor
  components/  interface
assets/        logotipo e arte da empresa
data/          banco local (fora do controle de versão)
docs/          especificações e planos
```
A pasta `domain` não importa nada de `server` nem de `app`. Isso permite testar o cálculo de preços isoladamente.

**Migração futura:** como o acesso ao banco passa pelo Drizzle, trocar SQLite por PostgreSQL é uma alteração localizada.

## 4. Modelo de dados

- `usuario` (nome, e-mail, senha_hash, perfil, pode_ver_custo, ativo)
- `sessao` (hash do token, usuário, expira_em)
- `fornecedor` (nome, site, observações)
- `produto` (sku_interno, fabricante, modelo, categoria, descrição, especificações em JSON, ativo)
- `oferta_custo` (produto, fornecedor, sku_fornecedor, url_produto, custo_centavos, observação, obtido_em, valido_ate). **Cada atualização cria nova linha**, o que preserva o histórico.
- `regra_margem` (escopo: categoria ou fabricante, margem_bps, margem_minima_bps, validade_custo_dias opcional — pré-preenche a validade do custo, útil para SSD e memória)
- `configuracao` (dados da empresa, validade padrão de custo em dias, validade da proposta, percentual de impostos, textos padrão)
- `cliente` (razão social, CNPJ, contato, e-mail, telefone)
- `orcamento` (número, cliente, status, validade, condições, observações, totais, criado_por)
- `orcamento_item` (produto, descrição, quantidade, **custo, margem e preço unitários congelados**, desconto)
- `auditoria` (usuário, ação, entidade, antes/depois, data)

**Dinheiro:** sempre em **inteiros (centavos)**; percentuais em **pontos-base** (1% = 100). Nunca usar ponto flutuante.

## 5. Regras de negócio

- **Custo vigente** de um produto: a oferta mais barata que ainda esteja dentro da validade. Sem oferta válida, o item fica **sem preço** e não entra no cálculo.
- **Preço de venda:** `custo / (1 − margem − impostos)`, arredondado para cima ao centavo. A margem é calculada sobre o preço de venda. A regra aplicada é a do fabricante, se existir; senão a da categoria; senão a padrão.
- **Margem mínima:** abaixo dela, o orçamento só pode ser enviado por um administrador.
- **Custo vencido:** o item aparece em destaque no carrinho. O envio é bloqueado até a oferta ser reconfirmada ou o administrador autorizar explicitamente (fica na auditoria).
- **Congelamento:** ao adicionar o item, custo, margem e preço são copiados para o orçamento. Mudanças posteriores no catálogo **não** alteram orçamentos existentes. Ao duplicar ou reenviar, o sistema compara com o catálogo e avisa das diferenças.
- **Numeração:** sequencial por ano (ex.: 2026-0001), gerada em transação para evitar duplicidade.
- **Expiração:** orçamentos enviados mudam para "expirado" ao passar da validade.

## 6. Fluxo principal

1. Cadastrar ou atualizar o item (manual ou por colagem com IA).
2. Abrir um novo orçamento, escolher o cliente.
3. Buscar itens por SKU, modelo ou texto e adicioná-los ao carrinho.
4. Ajustar quantidades, margem e descontos; incluir frete e serviços.
5. Resolver os alertas (custo vencido, margem baixa).
6. Exportar PDF e/ou XLSX e marcar como enviado.
7. Registrar o resultado (aprovado ou recusado, com motivo).

## 7. Segurança

**Autenticação e sessão**
- Senhas com argon2id; política mínima de tamanho; nenhuma senha em texto no código ou em logs.
- Token de sessão aleatório de 256 bits. Só o hash é guardado no banco. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` quando houver HTTPS. Expiração e revogação ao sair.
- Limite de tentativas de login (por conta e por IP), com atraso progressivo.

**Autorização**
- Toda verificação é feita **no servidor**, em cada ação, nunca só na interface.
- Perfis: `administrador` e `vendedor`. A permissão `pode_ver_custo` controla o acesso a custo, margem e histórico de ofertas. Para quem não tem a permissão, esses campos **não são enviados ao navegador**.
- Aprovação de margem abaixo do mínimo e de uso de custo vencido: só administrador.

**Dados e entradas**
- Validação de toda entrada com Zod; consultas parametrizadas (sem SQL montado por texto).
- Proteção CSRF: cookies `SameSite` e verificação de origem nas ações que alteram dados.
- Saída escapada na interface e no PDF.
- **XLSX:** células de texto que comecem com `=`, `+`, `-` ou `@` recebem prefixo de neutralização, para evitar injeção de fórmulas.
- Envio de arquivos limitado a logotipo (tipo e tamanho verificados). Sem execução de arquivos enviados.

**IA**
- O texto colado é tratado como **dado**, nunca como instrução. A resposta passa por esquema Zod e é apresentada num formulário para o usuário conferir antes de salvar.
- A IA não recebe custos nem dados de clientes, não grava no banco e não altera valores de orçamento.
- Chave da API somente no servidor; limite de uso e de tamanho do texto enviado.

**Operação**
- Segredos em `.env` (fora do controle de versão), com `.env.example` sem valores reais.
- Servidor escutando só na rede interna; HTTPS ao expor fora dela.
- Trilha de auditoria de alterações de preço, margem, status e permissões.
- **Backup diário** do arquivo do banco (cópia consistente), com retenção de 30 dias e instrução de restauração testada.
- Dependências com versões fixas e verificação periódica de vulnerabilidades.

## 8. Tratamento de erros

- Falhas de validação retornam mensagens por campo, sem expor detalhes internos.
- Erros inesperados são registrados em log (sem dados sensíveis) e a tela mostra mensagem genérica.
- Falha da IA ou ausência de chave: o cadastro manual continua funcionando.
- Operações compostas (numeração, congelamento de itens, mudança de status) acontecem em transação.

## 9. Testes

- **Domínio (unitário, escrito antes do código):** cálculo de preço e margem, arredondamento, regra de margem mínima, escolha do custo vigente, validade, numeração.
- **Segurança:** autorização por perfil, ocultação de custo, limite de tentativas, neutralização de fórmulas no XLSX.
- **Fluxo ponta a ponta:** cadastrar item → montar orçamento → exportar PDF e XLSX.
- **Conferência manual:** 3–5 orçamentos reais recentes refeitos no sistema, comparando o total com o valor praticado.

## 10. Marcos de entrega

1. **M1 Fundação:** projeto, banco, login, perfis, auditoria, backup.
2. **M2 Catálogo:** fornecedores, produtos, ofertas de custo, validade, regras de margem, busca.
3. **M3 Orçamento:** clientes, carrinho, cálculo, congelamento, numeração, status, duplicar.
4. **M4 Exportação:** PDF com a arte e XLSX.
5. **M5 Endurecimento:** revisão de segurança, testes completos, restauração de backup, guia de uso.
6. **M6 (opcional, adiado por decisão do usuário): IA no cadastro** — colar texto do fornecedor → formulário conferido pelo usuário. Só será planejado se a digitação manual se mostrar um problema.

## 11. Pendências

- Logotipo e arte da empresa (a pasta `assets/` está vazia). Enviar os arquivos antes do M4.
- Exemplos de 3–5 orçamentos reais e de páginas de fornecedores, para os testes e para o M5.
- Confirmar as premissas P1 a P4.
- Definir se o vendedor pode ver o custo (padrão: não).
- Pasta não está em um repositório Git: o primeiro passo do plano será criar o repositório com `.gitignore` para `.env` e `data/`.
