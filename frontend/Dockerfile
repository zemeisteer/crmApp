# TalimCRM frontend — multi-stage build (Next.js standalone output)
FROM node:22-alpine AS base

# Step 1: Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Step 2: Build the Next.js application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ROOT_DOMAIN=crmapp.com
ENV NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Step 3: Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# What this image was built from and for (see scripts/production/release-info.sh).
ARG APP_REVISION=unknown
ARG NEXT_PUBLIC_ROOT_DOMAIN=crmapp.com
ARG NEXT_PUBLIC_API_URL=/api
LABEL org.opencontainers.image.revision=$APP_REVISION \
      uz.talimcrm.root-domain=$NEXT_PUBLIC_ROOT_DOMAIN \
      uz.talimcrm.api-url=$NEXT_PUBLIC_API_URL
USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
