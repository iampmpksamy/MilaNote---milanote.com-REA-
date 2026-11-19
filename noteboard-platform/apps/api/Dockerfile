# syntax=docker/dockerfile:1.7
# noteboard-server: the API, the background worker, the one-time init and the recovery console.
# Build from noteboard-platform/:  docker build -f apps/api/Dockerfile -t noteboard-server .
ARG NODE_IMAGE=node:26.13.1-alpine
ARG BUILD_IMAGE=node:26.13.1-bookworm-slim

FROM ${BUILD_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/board-model packages/board-model
COPY apps/api apps/api
ARG NOTEBOARD_VERSION=0.0.0-dev
RUN NOTEBOARD_VERSION=${NOTEBOARD_VERSION} node apps/api/build.mjs

FROM ${NODE_IMAGE}
ARG NOTEBOARD_VERSION=0.0.0-dev
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="noteboard-server" \
      org.opencontainers.image.description="Noteboard Homelab Edition: API, worker, init and console tools" \
      org.opencontainers.image.version="${NOTEBOARD_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/iampmpksamy/MilaNote---milanote.com-REA-" \
      org.opencontainers.image.licenses="MIT"
RUN apk add --no-cache tini && mkdir -p /data && chown 1000:1000 /data
ENV NODE_ENV=production NOTEBOARD_DATA=/data NOTEBOARD_VERSION=${NOTEBOARD_VERSION}
WORKDIR /app
COPY --from=build --chown=0:0 /src/dist/apps/api/ /app/
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "main.js"]
