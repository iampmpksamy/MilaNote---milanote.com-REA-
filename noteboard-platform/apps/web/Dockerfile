# syntax=docker/dockerfile:1.7
# noteboard-gateway: the built web app (boards, sign-in, /admin) and the reverse proxy to the API.
# Build from noteboard-platform/:  docker build -f apps/web/Dockerfile -t noteboard-gateway .
ARG BUILD_IMAGE=node:26.13.1-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.31.7-alpine

FROM ${BUILD_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx nx build web --skip-nx-cache --output-style=static

FROM ${NGINX_IMAGE}
ARG NOTEBOARD_VERSION=0.0.0-dev
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="noteboard-gateway" \
      org.opencontainers.image.description="Noteboard Homelab Edition: web app and gateway" \
      org.opencontainers.image.version="${NOTEBOARD_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/iampmpksamy/MilaNote---milanote.com-REA-" \
      org.opencontainers.image.licenses="MIT"
# The stock site config is replaced by ours (rendered from the template at start).
COPY apps/web/gateway/empty.conf /etc/nginx/conf.d/default.conf
COPY apps/web/gateway/noteboard.conf.template /etc/nginx/templates/noteboard.conf.template
COPY apps/web/gateway/security-headers.conf apps/web/gateway/proxy.conf /etc/nginx/snippets/
COPY --from=build --chown=0:0 /src/dist/apps/web/browser/ /usr/share/nginx/html/
ENV NB_API_UPSTREAM=noteboard-api:3000 NB_MAX_UPLOAD_MB=25 NB_RESOLVER=127.0.0.11
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
