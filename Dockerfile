FROM node:26.12.1-alpine

# Node 26 ships without corepack, so pnpm is installed explicitly (version matches package.json packageManager)
RUN npm install -g pnpm@12.21.0

WORKDIR /app

# Dependencies first for layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src ./src
COPY spec ./spec

ENV NODE_ENV=production \
    DOPPELDESK_DATA_DIR=/data

# Data directory writable by the unprivileged user
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/__doppeldesk/health || exit 1

CMD ["node", "src/main.ts"]
