# syntax=docker/dockerfile:1
# ============================================
# SPA build
# ============================================
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# Empty means same-origin: Traefik routes /api to the backend (see deploy/).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm run build

# ============================================
# Static serving
# ============================================
FROM nginxinc/nginx-unprivileged:1-alpine AS runtime

EXPOSE 8080

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=101:101 /app/dist /usr/share/nginx/html
COPY --from=builder /app/dist/index.html /usr/share/nginx/index.html.template
COPY --chown=101:101 docker-entrypoint.d/40-generate-runtime-config.sh /docker-entrypoint.d/40-generate-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-generate-runtime-config.sh
