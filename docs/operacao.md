# Operação

## Onde ficam os dados

- Banco: `%LOCALAPPDATA%\TechMasterOrcamentos\orcamentos.db` (ou o caminho em `DATABASE_PATH`). **Não** coloque o banco dentro do OneDrive: a sincronização pode corromper o arquivo.
- Segredos no arquivo `.env` (não vai para o Git): `SESSION_SECRET` (sessões) e **`TOTP_ENCRYPTION_KEY`** (criptografa os segredos do 2FA no banco).
- ⚠️ **Faça cópia do `.env` junto com os backups do banco.** Sem a `TOTP_ENCRYPTION_KEY` original, os 2FA já cadastrados ficam ilegíveis e todos precisam reconfigurar (use `npm run reset-2fa -- email` para cada usuário). Nunca coloque o `.env` no Git nem em e-mail.

## Backup diário

```bash
npm run backup                      # grava em .\backups\orcamentos-AAAA-MM-DD.db
npm run backup -- D:\backups\orc    # outra pasta
```

- Cada backup é um arquivo único, verificado (`integrity_check`). Cópias com mais de 30 dias são removidas automaticamente.
- **Agende no Agendador de Tarefas do Windows:** ação "Iniciar um programa", programa `cmd`, argumentos `/c cd /d C:\Dev\Orcamentos && npm run backup -- D:\backups\orc`, disparador diário.
- Mantenha também uma cópia em outro disco ou na nuvem (a pasta de backup **pode** ficar no OneDrive; o banco ativo não).

## Restaurar

1. Pare o sistema.
2. Copie o backup escolhido para o caminho do banco, com o nome `orcamentos.db` (apague antes os arquivos `orcamentos.db-wal` e `orcamentos.db-shm`, se existirem).
3. Inicie o sistema e confira os orçamentos mais recentes.

## Administração

- Novo administrador: `npm run create-admin` (no primeiro login ele configura o 2FA).
- 2FA de alguém travado: `Usuários → Redefinir 2FA` (administrador) ou, pelo servidor, `npm run reset-2fa -- email@empresa.com`.
- Esqueceu a senha de um usuário: outro administrador usa **Usuários → Redefinir senha**.
- Se o servidor ficar acessível pela rede interna **sem HTTPS**, defina `INSECURE_COOKIES=1` no `.env` (caso contrário o cookie de sessão `Secure` não é aceito fora de `localhost`). Prefira HTTPS ao expor fora do escritório.

## Atualizações

Depois de atualizar o código: `npm install`, `npm run build` e reinicie. As migrações do banco rodam sozinhas na inicialização.
