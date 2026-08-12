# Built from the repository root, because the API imports @finance/shared —
# a workspace sibling that has to be compiled first and is not visible from
# apps/api.

FROM node:22-alpine AS build
WORKDIR /repo

# Manifests first, so a change to source code does not re-run the install.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# --include=dev because NODE_ENV is production at run time and npm reads it
# during install too: a plain `npm ci` would drop TypeScript and nest-cli, and
# the build would fall through to whatever compiler the image happens to have.
RUN npm ci --include=dev

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @finance/shared \
 && npm run build --workspace @finance/api

# Drop the build toolchain from what actually ships.
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Runs as a non-root user. The official image ships one.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /repo/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /repo/package.json ./

USER node
EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
