# Deploy

O banco é **libSQL** (o mesmo SQL do SQLite). Em produção ele fica na nuvem, no **Turso**; no computador, continua sendo um arquivo. Por isso o sistema roda em **Vercel** sem disco permanente. Também continua funcionando em Docker/VPS com um arquivo (Opção B).

## Escolha

| Opção | Custo | Esforço | Observação |
|---|---|---|---|
| **A. Vercel + Turso** | Turso: grátis para começar; Vercel: veja a nota abaixo | baixo | HTTPS e endereço `*.vercel.app` prontos; cada `git push` publica sozinho |
| **B. VPS / Docker** (Hetzner, Contabo, Hostinger…) | ~US$ 4–6/mês | médio | `docker compose` incluído, HTTPS automático com domínio; banco em arquivo no volume |
| Fly.io | ~US$ 2–5/mês | baixo | `fly.toml` incluído (banco em arquivo no volume) |

> **Vercel Hobby (grátis) é só para uso pessoal/não comercial.** Para a empresa usar de verdade, o plano correto é o **Pro**. Confira os termos e os limites atuais na página de preços da Vercel.

## Segredos (qualquer opção)

Gere dois valores e **guarde uma cópia** em lugar seguro (sem o `TOTP_ENCRYPTION_KEY`, ninguém consegue usar o 2FA já cadastrado):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # use um para SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # use outro para TOTP_ENCRYPTION_KEY
```

## Opção A — Vercel + Turso

### 1. Criar o banco no Turso (uma vez)

1. Crie a conta em <https://turso.tech> e instale a CLI (`turso`), ou use o painel web.
2. Crie o banco: `turso db create orcamentos`. Escolha uma região **próxima das funções da Vercel** (por padrão, Washington/`iad1`, ou seja, AWS US East/Virginia); `turso db locations` lista as disponíveis e `--location` escolhe uma. Banco e funções na mesma região deixam cada consulta bem mais rápida.
3. Pegue os dois valores:
   ```bash
   turso db show orcamentos --url          # libsql://orcamentos-SEU-USUARIO.turso.io
   turso db tokens create orcamentos       # token de acesso (guarde)
   ```

### 2. Configurar a Vercel

Em **Project → Settings → Environment Variables** (marque *Production* e, se for usar, *Preview*):

| Variável | Valor |
|---|---|
| `TURSO_DATABASE_URL` | a URL `libsql://…` |
| `TURSO_AUTH_TOKEN` | o token |
| `SESSION_SECRET` | 64 hex gerado acima |
| `TOTP_ENCRYPTION_KEY` | 64 hex gerado acima (não perca) |

(Se você conectar o Turso pela aba **Storage/Integrations** da Vercel, as duas primeiras são preenchidas sozinhas.)

Não é preciso mudar o *Build Command*: o projeto tem o script `vercel-build`, que **cria/atualiza as tabelas no Turso a cada deploy** (`npm run db:migrate`) e depois faz o build. Se faltar a URL do banco, o build falha com uma mensagem explicando.

> Todos os ambientes que usarem as mesmas variáveis usam o **mesmo banco**. Para testar sem risco, crie um segundo banco no Turso para *Preview*.

### 3. Publicar e criar o seu usuário Root

Faça o *push* para o GitHub (a Vercel publica sozinha). A Vercel não tem terminal, então o primeiro usuário é criado **no seu computador, apontando para o banco da nuvem**:

```bash
# no seu computador, na pasta do projeto: crie um arquivo .env.turso com as 4 variáveis acima e rode:
npx tsx --env-file=.env.turso scripts/admin/create-root.ts
```

(`.env.turso` está no `.gitignore`; nunca o envie ao Git. Se o primeiro deploy ainda não rodou, crie as tabelas antes com `npx tsx --env-file=.env.turso scripts/ops/migrate.ts`.) Depois abra o site, entre e configure o Google Authenticator.

### Limites da Vercel que o sistema já respeita

- **Uploads de até 4 MB** por arquivo (planilha de fornecedor ou foto): a Vercel recusa requisições acima de ~4,5 MB. Planilhas de 2.000 linhas ficam bem abaixo disso; reduza fotos muito grandes antes de enviar.
- **Tempo de execução:** importações, PDFs e fotos têm `maxDuration = 60 s`.
- **Sem disco:** o banco está no Turso, o logo do PDF é empacotado junto da função (`outputFileTracingIncludes`), e o limite de tentativas de login é gravado no banco (a memória das funções não é compartilhada).

## Opção B — VPS ou VM (Docker Compose)

1. Instale Docker na máquina e aponte um **domínio** (ou subdomínio) para o IP dela. Libere as portas **80 e 443** no firewall do provedor.
2. Baixe o código: `git clone https://github.com/guipachecco/tech-ors.git && cd tech-ors`
3. Crie o arquivo `.env.production` (não vai para o Git):
   ```
   SESSION_SECRET=...
   TOTP_ENCRYPTION_KEY=...
   ```
   e o arquivo `.env` com o domínio: `DOMAIN=orcamentos.suaempresa.com.br`
4. Suba: `docker compose up -d --build`
5. Crie o seu Root: `docker compose exec -it app npm run create-root`

O banco fica num arquivo no volume `/data` (`DATABASE_PATH`), e as migrações rodam sozinhas ao iniciar. O Caddy obtém e renova o certificado HTTPS. Atualizar depois: `git pull && docker compose up -d --build`.

(Também dá para apontar a Opção B para o Turso: defina `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` e rode `npm run db:migrate` a cada atualização.)

## Opção C — Fly.io

```bash
fly auth login
fly launch --no-deploy --copy-config
fly volumes create orcamentos_data --size 1 --region gru
fly secrets set SESSION_SECRET=... TOTP_ENCRYPTION_KEY=...
fly deploy
fly ssh console -C "npm run create-root"
```

## Depois de publicar

- Entre, configure o Google Authenticator e guarde os códigos de recuperação.
- Em **Regras e configurações**, confira dados da empresa, margens e impostos.
- **Backup:** veja `docs/operacao.md` (no Turso o backup é um arquivo `.sql` gerado do seu computador com `npm run backup`).
- Levar os dados do computador para o Turso: gere o `.sql` do banco local e restaure no banco novo (`docs/operacao.md`, "Mudar de banco").
- Não defina `INSECURE_COOKIES`: em produção o site precisa estar em HTTPS (Vercel já está).
