# Build a partir da raiz do repositório: docker build -f control-plane/Dockerfile .

# 1. Compila o CLI harness como binário estático.
FROM golang:1.27-alpine AS cli
WORKDIR /src
COPY cli/ ./
ARG HARNESS_VERSION=dev
ARG HARNESS_COMMIT=unknown
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${HARNESS_VERSION} -X main.commit=${HARNESS_COMMIT}" \
    -o /out/harness ./cmd/harness

# 2. Instala só as dependências de produção da API.
FROM node:24-alpine AS deps
WORKDIR /app
COPY control-plane/package.json control-plane/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 3. Imagem final: Node executa o TypeScript direto, sem etapa de build.
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=cli /out/harness /usr/local/bin/harness
COPY --from=deps /app/node_modules ./node_modules
COPY control-plane/package.json ./
COPY control-plane/src ./src
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
