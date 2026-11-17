FROM node:20-bookworm-slim

# git is needed by the bots to clone and push; openssl by Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends git openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
