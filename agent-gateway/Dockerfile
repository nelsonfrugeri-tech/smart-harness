# Build a partir da raiz do repositório: docker build -f agent-gateway/Dockerfile .

# 1. Instala só as dependências de produção do gateway.
FROM node:24-alpine AS deps
WORKDIR /app
COPY agent-gateway/package.json agent-gateway/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 2. Imagem final: Node executa o TypeScript direto, sem etapa de build.
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8081
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY agent-gateway/package.json ./
COPY agent-gateway/src ./src
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8081
CMD ["node", "src/main.ts"]
