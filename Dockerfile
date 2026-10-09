# syntax=docker/dockerfile:1
# Sistema de orçamentos. Imagem de produção em 3 etapas (dependências → build → execução).

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- 1) dependências (inclui ferramentas de compilação, só se algum módulo nativo precisar) ----------
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
# Falha cedo se algum módulo nativo não carregar neste Linux (banco, imagens, senha).
RUN node -e "const D=require('better-sqlite3');new D(':memory:').prepare('select 1').get();require('sharp');require('@node-rs/argon2');console.log('módulos nativos ok')"

# ---------- 2) build do Next.js ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Valores só para o build (não vão para a imagem final; em produção vêm do ambiente).
ENV SESSION_SECRET=build-only-build-only-build-only-0000 \
    DATABASE_PATH=/tmp/build.db
RUN npm run build

# ---------- 3) execução ----------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/orcamentos.db
RUN useradd --system --uid 1001 --create-home app \
    && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/assets/logo.png ./assets/logo.png
COPY --from=build --chown=app:app /app/package.json /app/next.config.ts /app/tsconfig.json ./
# src e scripts: necessários para os comandos de administração (npm run create-root, backup, reset-2fa)
COPY --from=build --chown=app:app /app/src ./src
COPY --from=build --chown=app:app /app/scripts ./scripts
USER app
# O banco fica em /data: monte um volume permanente aqui, senão os dados somem a cada deploy.
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
