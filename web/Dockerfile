FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
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
