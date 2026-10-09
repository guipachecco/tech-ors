# Orçamentos B2B

Sistema local para montar, calcular e exportar orçamentos de equipamentos de TI (PDF e XLSX), com custo e validade por fornecedor, regras de margem, perfis de acesso e auditoria.

- Especificação: `docs/superpowers/specs/2026-10-09-orcamentos-mvp-design.md`
- Plano: `docs/superpowers/plans/2026-10-09-orcamentos-mvp.md`
- Uso diário: `docs/guia-de-uso.md` · Operação e backup: `docs/operacao.md`

## Primeiro uso

```bash
npm install
npm run create-admin        # cria o administrador (a senha é digitada oculta)
                            # no primeiro login ele configura o Google Authenticator (2FA)
npm run build
npm start                   # http://localhost:3000
```

No Windows, dê dois cliques em `iniciar.bat` (faz o build se precisar e sobe o servidor).

O arquivo `.env` precisa ter `SESSION_SECRET` (32+ caracteres) e `TOTP_ENCRYPTION_KEY` (64 hex); veja `.env.example` e **guarde uma cópia do `.env`**. O banco fica em
`%LOCALAPPDATA%\TechMasterOrcamentos\orcamentos.db`, **fora do OneDrive**.

## Demonstração (banco de teste separado)

```bash
npm run seed:dev     # cria dados de exemplo em data/dev.db (usuários de teste no arquivo scripts/dev-seed.ts)
npm run dev:demo     # http://localhost:3100
```

## Testes

```bash
npm test
```

## Identidade visual

- Logo e cores vêm do manual de marca (`assets/brand/TechMaster.pdf`): roxo `#6D609E` (Pantone 265 C), verde `#84C225` (382 C), ciano `#3BB3C2` (319 C).
- Logos vetoriais em `public/brand/` (usados na tela de login e no cabeçalho) e `assets/logo.png` (usado no PDF dos orçamentos).
- Tema escuro por padrão, com alternância claro/escuro no cabeçalho (preferência salva em cookie). A tela de login é sempre escura.
