# ---------------------------------------------------------------------------
# FayTarra — container image for any Node host (Cloud Run, Fly, Render,
# Railway, Kubernetes, App Hosting with a custom build).
#
# FayTarra is server-rendered: server actions, dynamic pages, route handlers
# and uploads. There is no static bundle to hand a CDN, so the deployable
# artefact is this Node server.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `npm run build` also runs scripts/prepare-standalone.mjs, which copies the
# static assets into the standalone bundle. Without that step the server
# answers with HTML whose stylesheets and scripts all 404.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# The standalone bundle carries only the dependencies actually traced.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Writable home for the local JSON driver. A container filesystem is ephemeral,
# so this is only useful for a demo image — set the Supabase variables for a
# real deployment and nothing is written here at all.
RUN mkdir -p /app/.data && chown -R nextjs:nodejs /app/.data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
