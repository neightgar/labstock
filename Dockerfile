# Stage 1: Install dependencies (needs build tools for native modules)
FROM node:18-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Generate Prisma client
FROM deps AS prisma
COPY prisma ./prisma
RUN npx prisma generate

# Stage 3: Final minimal image
FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache su-exec

# Copy production deps and generated Prisma client
COPY --from=prisma /app /app

# Copy source code
COPY src ./src
COPY public ./public
COPY views ./views
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Create persistent data directories
RUN mkdir -p /app/data /app/uploads /app/backups \
    && chown -R node:node /app \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
