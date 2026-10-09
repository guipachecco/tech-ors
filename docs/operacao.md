# Operação

## Onde ficam os dados

- **Computador / servidor próprio:** arquivo `%LOCALAPPDATA%TechMasterOrcamentosorcamentos.db` (ou o caminho em `DATABASE_PATH`). **Não** coloque o banco dentro do OneDrive: a sincronização pode corromper o arquivo.
- **Na nuvem (Vercel):** banco no **Turso**, indicado por `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (ou `DATABASE_URL` + `DATABASE_AUTH_TOKEN`). Veja `docs/deploy.md`.
- Segredos no arquivo `.env` (não vai para o Git) ou nas variáveis de ambiente da Vercel: `SESSION_SECRET` (sessões) e **`TOTP_ENCRYPTION_KEY`** (criptografa os segredos do 2FA no banco).
- ⚠️ **Faça cópia desses valores junto com os backups do banco.** Sem a `TOTP_ENCRYPTION_KEY` original, os 2FA já cadastrados ficam ilegíveis e todos precisam reconfigurar (use `npm run reset-2fa -- email` para cada usuário). Nunca coloque o `.env` no Git nem em e-mail.

## Backup diário

```bash
npm run backup                      # grava em .ackupsorcamentos-AAAA-MM-DD.db (ou .sql, veja abaixo)
npm run backup -- D:ackupsorc    # outra pasta
```

- **Banco em arquivo:** o backup é uma cópia exata (`.db`). **Banco no Turso:** é uma exportação em texto (`.sql`) com a estrutura e todos os dados. Para fazer o backup do Turso a partir do seu computador, crie o arquivo `.env.turso` (as variáveis do Turso) e rode `npx tsx --env-file=.env.turso scripts/ops/backup.ts D:ackupsorc`.
- Cada backup é verificado ao ser criado. Cópias com mais de 30 dias são removidas automaticamente.
- **Agende no Agendador de Tarefas do Windows:** ação "Iniciar um programa", programa `cmd`, argumentos `/c cd /d C:DevOrcamentos && npm run backup -- D:ackupsorc`, disparador diário.
- Mantenha também uma cópia em outro disco ou na nuvem (a pasta de backup **pode** ficar no OneDrive; o banco ativo não). O Turso também mantém histórico próprio (recuperação até um ponto no tempo, conforme o plano) — mesmo assim, guarde seus backups.

## Restaurar

**Banco em arquivo (`.db`):**

1. Pare o sistema.
2. Copie o backup escolhido para o caminho do banco, com o nome `orcamentos.db` (apague antes os arquivos `orcamentos.db-wal` e `orcamentos.db-shm`, se existirem).
3. Inicie o sistema e confira os orçamentos mais recentes.

**Backup `.sql` (Turso ou qualquer banco):** a restauração é sempre num banco **novo e vazio** (o comando recusa um banco que já tenha tabelas).

1. Crie o banco novo (no Turso: `turso db create orcamentos-novo`, depois URL e token como no deploy).
2. Aponte as variáveis (`.env.turso`) para ele e rode: `npx tsx --env-file=.env.turso scripts/ops/restore.ts D:ackupsorcorcamentos-2026-10-09.sql`
3. Troque `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` na Vercel para o banco novo e faça um novo deploy.

## Mudar de banco (do computador para o Turso)

1. No computador (com o sistema parado), gere uma exportação SQL do banco em arquivo: `npm run backup -- --sql D:ackupsorc`.
2. Crie o banco vazio no Turso e restaure esse `.sql` nele (passos de "Restaurar" acima). A exportação já leva a estrutura e o histórico de migrações, então o próximo deploy não tenta recriar nada.
3. Use na Vercel a **mesma `TOTP_ENCRYPTION_KEY`** de antes (senão os 2FA cadastrados deixam de funcionar).

## Perfis

- **Root** (dono do sistema): tudo o que o administrador faz, mais criar administradores e alterar qualquer conta. **Só o Root altera a conta Root** (senha, 2FA, acesso); ela não pode ser desativada pela aplicação. Só nasce pelo servidor: `npm run create-root` (ou `npm run promote-root -- email` para promover um usuário existente).
- **Administrador**: configurações, regras, custos, usuários — mas cria apenas vendedores e não mexe na conta Root.
- **Vendedor**: orçamentos; custo e margem só com a permissão "Mostrar custos".

## Administração

- Seu primeiro acesso: `npm run create-root` (e-mail e senha digitados no terminal; no primeiro login você configura o Google Authenticator).
- Novo administrador (pelo servidor): `npm run create-admin` (no primeiro login ele configura o 2FA). Pela tela, só o Root cria administradores.
- 2FA de alguém travado: `Usuários → Redefinir 2FA` (administrador) ou, pelo servidor, `npm run reset-2fa -- email@empresa.com`.
- Esqueceu a senha de um usuário: outro administrador usa **Usuários → Redefinir senha**.
- Se o servidor ficar acessível pela rede interna **sem HTTPS**, defina `INSECURE_COOKIES=1` no `.env` (caso contrário o cookie de sessão `Secure` não é aceito fora de `localhost`). Prefira HTTPS ao expor fora do escritório.

## Atualizações

- **Computador / Docker (banco em arquivo):** `npm install`, `npm run build` e reinicie. As migrações rodam sozinhas na inicialização.
- **Vercel (Turso):** basta enviar o código ao GitHub; o deploy roda `npm run db:migrate` antes do build. Para aplicar as migrações à mão: `npx tsx --env-file=.env.turso scripts/ops/migrate.ts`.
