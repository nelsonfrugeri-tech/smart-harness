# Build from the repository root: docker build -f control-plane/Dockerfile .

# 1. Compiles the harness CLI as a static binary.
FROM golang:1.27-alpine AS cli
WORKDIR /src
COPY cli/ ./
ARG HARNESS_VERSION=dev
ARG HARNESS_COMMIT=unknown
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${HARNESS_VERSION} -X main.commit=${HARNESS_COMMIT}" \
    -o /out/harness ./cmd/harness

# 2. Installs only the API production dependencies.
FROM node:24-alpine AS deps
WORKDIR /app
COPY control-plane/package.json control-plane/package-lock.json ./
# better-sqlite3 ships prebuilt binaries (musl included), so no install script or compiler is needed.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# 3. Final image: Node runs the TypeScript directly, with no build step.
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/control-plane.sqlite
WORKDIR /app
COPY --from=cli /out/harness /usr/local/bin/harness
COPY --from=deps /app/node_modules ./node_modules
COPY control-plane/package.json ./
COPY control-plane/src ./src
COPY control-plane/migrations ./migrations
COPY control-plane/seed ./seed
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
