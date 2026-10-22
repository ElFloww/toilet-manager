# syntax=docker/dockerfile:1

# ---- 1. Construction : site (Vite) + serveur compilé en un seul fichier ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && npx esbuild server/index.ts --bundle --platform=node --format=esm \
      --packages=external --target=node22 --outfile=build/server.mjs

# ---- 2. Image finale : uniquement les dépendances de production ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    TZ=Europe/Paris
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/build/server.mjs ./server.mjs
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3001/api/state || exit 1
CMD ["node", "server.mjs"]
