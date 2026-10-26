FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /web
COPY --from=build /web/dist ./dist
COPY server.mjs ./server.mjs
# Keep the same Debian/Node runtime; remove tools not used by the static server.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
       /usr/bin/mount /usr/bin/umount /usr/bin/nsenter /usr/sbin/blkid /usr/sbin/findfs \
       /usr/bin/lsblk /usr/bin/infocmp /usr/bin/gzip \
    && find /usr -xdev -type f -perm /6000 -exec chmod a-s {} +
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
