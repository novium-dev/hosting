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

# Build-time default; overridable at container runtime (see
# docker-entrypoint.d/40-generate-runtime-config.sh) without rebuilding.
ARG VITE_APP_NAME=""
ENV VITE_APP_NAME=$VITE_APP_NAME

# Branding and legal links; both empty by default. Without a logo URL the SPA
# renders no logo, without the legal URLs it renders no sign-in legal notice.
# Overridable at container runtime like VITE_APP_NAME.
ARG VITE_LOGO_URL=""
ENV VITE_LOGO_URL=$VITE_LOGO_URL

ARG VITE_TERMS_URL=""
ENV VITE_TERMS_URL=$VITE_TERMS_URL

ARG VITE_PRIVACY_URL=""
ENV VITE_PRIVACY_URL=$VITE_PRIVACY_URL

ARG VITE_IMPRINT_URL=""
ENV VITE_IMPRINT_URL=$VITE_IMPRINT_URL

# Cloudflare's proxy caps request bodies at 100 MB; when set, the SPA rejects
# larger uploads itself. Overridable at container runtime like VITE_APP_NAME.
ARG VITE_BEHIND_CLOUDFLARE=""
ENV VITE_BEHIND_CLOUDFLARE=$VITE_BEHIND_CLOUDFLARE

RUN bun run build

# ============================================
# Static serving
# ============================================
FROM nginxinc/nginx-unprivileged:1-alpine AS runtime

EXPOSE 8080

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=101:101 /app/dist /usr/share/nginx/html
COPY --chown=101:101 docker-entrypoint.d/40-generate-runtime-config.sh /docker-entrypoint.d/40-generate-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-generate-runtime-config.sh
