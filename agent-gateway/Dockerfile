# Build from the repository root: docker build -f agent-gateway/Dockerfile .

# 1. Installs only the gateway production dependencies.
FROM node:24-alpine AS deps
WORKDIR /app
COPY agent-gateway/package.json agent-gateway/package-lock.json ./
# better-sqlite3 ships prebuilt binaries (musl included), so no install script or compiler is needed.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# 2. Final image: Node runs the TypeScript directly, with no build step.
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8081 DATABASE_PATH=/data/control-plane.sqlite
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY agent-gateway/package.json ./
COPY agent-gateway/src ./src
COPY examples/investimentos-api ./examples/investimentos-api
ENV PROJECT_CONTEXT_ROOT=/app/examples
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8081
CMD ["node", "src/main.ts"]
