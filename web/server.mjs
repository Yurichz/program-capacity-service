import { createServer, request as proxyRequest } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createWebServer({
  root = resolve('dist'),
  api = 'http://app:3000',
  demo = 'http://demo-tools:3001',
} = {}) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  };
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, 'http://web');
      const path = url.pathname;
      if (path.startsWith('/api/v1/') || path === '/api/v1' || path.startsWith('/demo-api/')) {
        const target = new URL(path + url.search, path.startsWith('/demo-api/') ? demo : api);
        const headers = { ...req.headers, host: target.host };
        for (const name of [
          'connection',
          'proxy-authorization',
          'proxy-authenticate',
          'upgrade',
          'te',
          'trailer',
          'keep-alive',
          'transfer-encoding',
        ])
          delete headers[name];
        const proxy = proxyRequest(
          target,
          { method: req.method, headers, timeout: 30000 },
          (upstream) => {
            res.writeHead(upstream.statusCode ?? 502, {
              ...upstream.headers,
              'cache-control': 'no-store',
            });
            upstream.on('error', () => res.destroy());
            upstream.pipe(res);
          },
        );
        const fail = () => {
          if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 503000,
                message: 'Service temporarily unavailable',
              },
            }),
          );
        };
        proxy.on('error', fail);
        proxy.on('timeout', () => proxy.destroy());
        req.on('aborted', () => proxy.destroy());
        res.on('close', () => {
          if (!res.writableFinished) proxy.destroy();
        });
        req.pipe(proxy);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      const file = resolve(root, '.' + decodeURIComponent(path));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      let selected = file;
      let info;
      try {
        info = await stat(selected);
      } catch {
        /* Known SPA routes use index.html below. */
      }
      if (!info?.isFile()) {
        if (
          !['/', '/login', '/overview', '/reservations', '/activity', '/treasury'].includes(path)
        ) {
          res.writeHead(404);
          res.end();
          return;
        }
        selected = resolve(root, 'index.html');
      }
      res.writeHead(200, {
        'content-type': types[extname(selected)] ?? 'application/octet-stream',
        'cache-control': selected.includes(`${sep}assets${sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      if (req.method === 'HEAD') res.end();
      else
        createReadStream(selected)
          .on('error', () => res.destroy())
          .pipe(res);
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createWebServer({
    api: process.env.API_UPSTREAM,
    demo: process.env.DEMO_UPSTREAM,
  });
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close();
      server.closeIdleConnections();
    });
}
