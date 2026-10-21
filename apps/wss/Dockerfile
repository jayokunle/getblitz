FROM node:24.22.1-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files for wss and every workspace package it depends on
# (@getblitz/websocket -> @getblitz/redis -> @getblitz/shared-types)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/wss/package.json ./apps/wss/
COPY packages/redis/package.json ./packages/redis/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/websocket/package.json ./packages/websocket/
COPY tooling/typescript/package.json ./tooling/typescript/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tooling/typescript ./tooling/typescript
COPY packages/redis ./packages/redis
COPY packages/shared-types ./packages/shared-types
COPY packages/websocket ./packages/websocket
COPY apps/wss ./apps/wss

# Bundle wss and its workspace/npm deps into a single dist/index.js
WORKDIR /app/apps/wss
RUN pnpm build

# Production image
FROM node:24.22.1-alpine AS runner

WORKDIR /app

# dist/index.js is self-contained; package.json marks it as ESM
COPY --from=base /app/apps/wss/dist ./dist
COPY --from=base /app/apps/wss/package.json ./

ENV NODE_ENV=production
ENV WSS_PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
