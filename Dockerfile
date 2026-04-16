# Stage 1: Install production dependencies (needs build tools for bcrypt)
FROM node:18-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Generate Prisma client
FROM deps AS prisma
COPY prisma ./prisma
RUN npx prisma generate

# Stage 3: Final minimal image
FROM node:18-alpine
WORKDIR /app

# Copy production deps and generated Prisma client
COPY --from=prisma /app /app

# Copy source code
COPY src ./src
COPY public ./public
COPY views ./views

# Create persistent data directories
RUN mkdir -p /app/data /app/uploads /app/backups \
    && chown -R node:node /app

EXPOSE 3000

USER node

CMD ["npm", "start"]
