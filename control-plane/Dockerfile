# Build from the repository root: docker build -f control-plane/Dockerfile .

# 1. Compiles the harness CLI as a static binary.
FROM golang:1.27-alpine AS cli
WORKDIR /src
COPY cli/ ./
ARG HARNESS_VERSION=dev
ARG HARNESS_COMMIT=unknown
ARG INSTALLER_VERSION=v0.2.1
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${HARNESS_VERSION} -X main.commit=${HARNESS_COMMIT}" \
    -o /out/harness ./cmd/harness
# Downloads use one release version independently of the API engine's development revision.
RUN set -eu; mkdir -p /out/install && \
    for os in darwin linux; do for arch in arm64 amd64; do \
      CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath \
        -ldflags "-s -w -X main.version=${INSTALLER_VERSION} -X main.commit=${HARNESS_COMMIT}" \
        -o "/out/install/harness-${INSTALLER_VERSION}-${os}-${arch}" ./cmd/harness; \
    done; done && \
    cd /out/install && sha256sum harness-* > SHA256SUMS

# 2. Installs only the API production dependencies.
FROM node:24-alpine AS deps
WORKDIR /app
COPY control-plane/package.json control-plane/package-lock.json ./
# better-sqlite3 ships prebuilt binaries (musl included), so no install script or compiler is needed.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# 3. Final image: Node runs the TypeScript directly, with no build step.
FROM node:24-alpine
ARG INSTALLER_VERSION=v0.2.1
ENV INSTALLER_VERSION=${INSTALLER_VERSION} INSTALLER_ASSETS_DIR=/app/install
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/control-plane.sqlite
WORKDIR /app
COPY --from=cli /out/harness /usr/local/bin/harness
COPY --from=cli /out/install ./install
COPY --from=cli /src/install.sh ./install/install.sh
COPY --from=deps /app/node_modules ./node_modules
COPY control-plane/package.json ./
COPY control-plane/src ./src
COPY control-plane/migrations ./migrations
COPY control-plane/seed ./seed
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
