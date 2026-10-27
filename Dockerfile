FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM build AS tools
RUN chown -R node:node /app/src /app/dist && chown node:node /app
USER node
CMD ["node", "scripts/dev.mjs", "prepare"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --omit=optional && npm cache clean --force

FROM base AS runtime
ARG REVISION=local
ARG SOURCE_URL
LABEL org.opencontainers.image.revision=$REVISION
LABEL org.opencontainers.image.source=$SOURCE_URL
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
# Runtime executes Node only. Remove package managers and affected, unused OS helper entry points.
# Package-scoped, expiring scanner assessments are documented in docs/security.md.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
       /usr/bin/mount /usr/bin/umount /usr/bin/nsenter /usr/sbin/blkid /usr/sbin/findfs \
       /usr/bin/lsblk /usr/bin/infocmp /usr/bin/gzip \
    && find /usr -xdev -type f -perm /6000 -exec chmod a-s {} +
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 CMD ["node", "-e", "const s=require('net').connect(3000,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
