# ============================================
# SPA build
# ============================================
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --no-save --frozen-lockfile

COPY . .

# Empty means same-origin: Traefik routes /api to the backend (see deploy/).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

# Empty falls back to "Hephaestus" (see vite.config.ts).
ARG VITE_APP_NAME=""
ENV VITE_APP_NAME=$VITE_APP_NAME

RUN bun run build

# ============================================
# Static serving
# ============================================
FROM nginxinc/nginx-unprivileged:1-alpine AS runtime

EXPOSE 8080

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
