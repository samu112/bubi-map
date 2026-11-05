FROM node:20-alpine

WORKDIR /app

# Install server deps first for better layer caching.
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund

# App code.
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Simple liveness check against the built-in endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

WORKDIR /app/server
CMD ["node", "index.js"]
