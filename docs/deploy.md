# Deploy

O sistema guarda tudo num arquivo SQLite e precisa de **disco permanente** e de **HTTPS**. Por isso **não serve para Vercel/Netlify** (sem disco e sem terminal). Use qualquer servidor que rode Docker com um volume.

## Escolha

| Opção | Custo | Esforço | Observação |
|---|---|---|---|
| **Fly.io** | ~US$ 2–5/mês (pago) | baixo | HTTPS e endereço `*.fly.dev` prontos; arquivo `fly.toml` incluído |
| **VPS barata** (Hetzner, Contabo, Hostinger…) | ~US$ 4–6/mês | médio | `docker compose` incluído, HTTPS automático com domínio |
| **Oracle Cloud "Always Free"** | grátis | alto | VM gratuita com disco; exige cartão para criar a conta, a capacidade às vezes está esgotada e o plano gratuito mudou em 2026 — confira a página oficial antes |
| Render / Koyeb / Railway grátis | — | — | **Não recomendado**: o plano grátis não tem disco permanente (os dados somem) |

## Segredos (qualquer opção)

Gere dois valores e **guarde uma cópia** em lugar seguro (sem o `TOTP_ENCRYPTION_KEY`, ninguém consegue usar o 2FA já cadastrado):

```bash
openssl rand -hex 32   # use um para SESSION_SECRET
openssl rand -hex 32   # use outro para TOTP_ENCRYPTION_KEY
```

No Windows (sem `openssl`): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Opção A — Fly.io

```bash
# 1. instale o flyctl e entre: https://fly.io/docs/flyctl/install/
fly auth login
# 2. edite o nome do app em fly.toml e crie o app e o volume (1 GB basta)
fly launch --no-deploy --copy-config
fly volumes create orcamentos_data --size 1 --region gru
# 3. cadastre os segredos
fly secrets set SESSION_SECRET=... TOTP_ENCRYPTION_KEY=...
# 4. publique
fly deploy
# 5. crie o seu usuário Root (terminal dentro do servidor)
fly ssh console -C "npm run create-root"
```

Acesse `https://SEU-APP.fly.dev`. Backup: `fly volumes snapshots list` / `fly ssh console -C "npm run backup -- /data/backups"`.

## Opção B — VPS ou VM Oracle (Docker Compose)

1. Instale Docker na máquina e aponte um **domínio** (ou subdomínio) para o IP dela. Libere as portas **80 e 443** no firewall do provedor (na Oracle, também na lista de segurança da rede).
2. Baixe o código: `git clone https://github.com/guipachecco/tech-ors.git && cd tech-ors`
3. Crie o arquivo `.env.production` (não vai para o Git):
   ```
   SESSION_SECRET=...
   TOTP_ENCRYPTION_KEY=...
   ```
   e o arquivo `.env` com o domínio: `DOMAIN=orcamentos.suaempresa.com.br`
4. Suba: `docker compose up -d --build`
5. Crie o seu Root: `docker compose exec -it app npm run create-root`

O Caddy obtém e renova o certificado HTTPS sozinho. Atualizar depois: `git pull && docker compose up -d --build` (os dados ficam no volume).

## Depois de publicar

- Entre, configure o Google Authenticator e guarde os códigos de recuperação.
- Em **Regras e configurações**, confira dados da empresa, margens e impostos.
- **Backup:** agende o comando `npm run backup -- /data/backups` (dentro do container) e copie os arquivos para fora do servidor. Para restaurar, veja `docs/operacao.md`.
- O banco novo começa **vazio**. Para levar os dados do seu computador, copie o arquivo `orcamentos.db` (com o sistema parado) para o volume `/data` e use a mesma `TOTP_ENCRYPTION_KEY` de antes.
- Não defina `INSECURE_COOKIES`: em produção o site precisa estar em HTTPS.
