FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --include=dev

COPY packages/shared packages/shared
COPY apps/web apps/web

# next.config.ts reads API_URL to build the /api rewrite, and a rewrite is
# decided at build time — so this has to be present now, not just at run time.
ARG API_URL
ENV API_URL=$API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build --workspace @finance/shared \
 && npm run build --workspace @finance/web

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/shared ./packages/shared
COPY --from=build --chown=node:node /repo/apps/web ./apps/web
COPY --from=build --chown=node:node /repo/package.json ./

USER node
EXPOSE 3000
WORKDIR /repo/apps/web

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
