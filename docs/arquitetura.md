# Arquitetura

Monólito modular em camadas. **As dependências só descem**; um teste automático (`tests/architecture`) falha se alguém quebrar a regra.

```
src/
  domain/    regras puras (dinheiro, preço, validade, status, leitura de linhas de planilha). Não depende de nada.
  infra/     o que sustenta o sistema: config, banco (cliente + tabelas), auditoria, backup, erros de validação.
  modules/   o negócio, um módulo por assunto (veja abaixo). Sem Next.js nem React (exceto o PDF).
  ui/        peças visuais genéricas (botões, campos, formulário de ação, tema, logo).
  app/       telas e rotas do Next.js. Finas: leem a sessão, validam a entrada e chamam os módulos.
    _shared/ ligação com o Next: sessão/cookies (session.ts) e ajuda para formulários (actions.ts).
  proxy.ts   porta de entrada (login obrigatório, proteção contra requisições de outro site).
```

## Quem pode usar quem

| Camada | Pode usar |
|---|---|
| `domain` | nada |
| `infra` | `domain` |
| `modules` | `infra`, `domain` |
| `ui` | `domain` |
| `app` | `ui`, `modules`, `infra`, `domain` |

Dentro de `modules`, também há uma lista do que cada um pode usar (sem ciclos):

| Módulo | O que faz | Usa |
|---|---|---|
| `auth` | senha, sessão, 2FA, permissões, proteção da conta Root | — |
| `users` | cadastro e acesso de usuários | `auth` |
| `clients` | clientes (CNPJ) | `auth` |
| `catalog` | produtos, fornecedores, custos, margens, configurações, fotos, importação de planilhas | `auth` |
| `quotes` | orçamentos: cálculo, congelamento de preço, envio, visão do cliente | `auth`, `catalog` |
| `exports` | PDF e XLSX do orçamento | `quotes` |

Dentro de `catalog` há uma subpasta por assunto (`products/`, `suppliers/`, `costs/`, `margins/`, `settings/`, `photos/`, `import/`), cada uma com um `service.ts`. `import/` tem um `index.ts` como porta de entrada.

## Padrões

- **Serviço:** função `(db, usuário, dados) → resultado`. Confere a permissão, valida com Zod, grava e registra auditoria. Não conhece HTTP.
- **Tela / ação:** em `app/`, chama o serviço e converte erros conhecidos em mensagem (`guard` em `app/_shared/actions.ts`).
- **Dinheiro:** sempre em centavos inteiros; percentuais em pontos-base (1% = 100).
- **Imports:** entre pastas diferentes use o apelido `@/` (ex.: `@/modules/quotes/service`); `./` só dentro da mesma pasta.
- **Tabelas:** `infra/db/schema/` (um arquivo por assunto + `index.ts`). Migrações em `drizzle/`.

## Outras pastas

```
scripts/
  admin/   comandos de servidor: criar admin/root, promover root, redefinir 2FA
  ops/     operação: backup
  dev/     desenvolvimento: dados de exemplo e servidor de demonstração
tests/     espelha src/ (domain, infra, modules) + architecture/ (regras de camadas)
drizzle/   migrações do banco (geradas e versionadas)
assets/    logotipo e manual de marca
public/    arquivos servidos pelo site (logos em /brand)
docs/      guias (uso, operação, arquitetura) e especificação/plano
exemplos/  planilhas de exemplo de fornecedores (fora do Git: tem preços comerciais)
```

## Como acrescentar algo

- **Nova regra de negócio pura** → `domain/` (com teste primeiro).
- **Nova funcionalidade** → no módulo que já cuida do assunto; se for um assunto novo, crie a pasta em `modules/`, declare o que ela pode usar em `tests/architecture/checker.ts` e a tabela em `infra/db/schema/`.
- **Nova tela** → `app/`, chamando o serviço. Formulário usado só por uma tela fica em `_components/` ao lado dela.
