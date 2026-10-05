# syntax=docker/dockerfile:1
# Two images from one file (Q42/Q53):
#   dev    — what docker-compose.yml builds: sources bind-mounted, `next dev`.
#   runner — the production build the e2e stack runs (docker-compose.e2e.yml),
#            so the browser suite exercises the bundle customers get, as a
#            non-root user with a health check.
# `deps` is shared so both reuse the one `npm ci` layer; `prod-deps` keeps the
# runtime image to what `next start` needs. Base pinned by digest (node:20-alpine).

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
# they are build arguments here; runtime environment only reaches the server.
# No default for the API URL: a production build that does not name its real
# API origin fails in lib/securityHeaders.js rather than shipping a policy
# for localhost (review round 7). docker-compose.e2e.yml passes it.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED=false
ARG NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS=30
ARG NEXT_PUBLIC_CONTACT_PHONE=
ARG NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS=365
# Empty = the photos come from the API origin; set when they move to object storage (Q52's policy).
ARG NEXT_PUBLIC_MEDIA_ORIGIN=
ARG NEXT_PUBLIC_APP_VERSION=docker
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED=$NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED \
    NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS=$NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS \
    NEXT_PUBLIC_CONTACT_PHONE=$NEXT_PUBLIC_CONTACT_PHONE \
    NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS=$NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS \
    NEXT_PUBLIC_MEDIA_ORIGIN=$NEXT_PUBLIC_MEDIA_ORIGIN \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_TELEMETRY_DISABLED=1
# The real secret is read at request time; the build only needs one to exist.
RUN NEXTAUTH_SECRET=build-only-not-a-secret npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
# Owned by the runtime user: the landing's server-side data (P1.2) lives in
# Next's Data Cache under .next/cache, which `next start` writes at runtime.
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder /app/public ./public
# next.config.js runs again under `next start`, with what it requires (Q52).
COPY package.json next.config.js ./
COPY lib/securityHeaders.js lib/cacheHeaders.js ./lib/
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/api/auth/providers >/dev/null || exit 1
CMD ["npm", "run", "start"]
