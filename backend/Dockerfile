# TalimCRM backend — multi-stage build (NestJS)
FROM node:22-alpine AS base

# Step 1: Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Step 2: Build the NestJS app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Step 3: Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl wget

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/scripts/migrate.cjs ./scripts/migrate.cjs

RUN mkdir -p /app/uploads && chown -R node:node /app

# The commit this image was built from (scripts/production/lib.sh passes it;
# "-dirty" when the checkout had uncommitted changes). Shown by /api/health
# and as an image label, so an operator can tell what is running. Declared
# last, so a new commit does not invalidate the dependency layers.
ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.revision=$APP_REVISION
USER node
EXPOSE 4000

# Pending SQL migrations first, then the API.
CMD ["sh", "-c", "node scripts/migrate.cjs && node dist/main.js"]
