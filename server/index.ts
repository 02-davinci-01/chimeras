// Local HTTP server (SPEC 7), bound to 127.0.0.1 only. Serves the two pages, build output, art, live Logseq pages and SSE.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import type { AppConfig } from '../build/types.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
};

export interface ServerContext {
  root: string;                       // holds dist/, art/, covers/, previews/, sounds/
  cfg: AppConfig;
  vite?: ViteDevServer;               // dev: pages come from Vite; otherwise from dist/web
}

export function createServer(ctx: ServerContext) {
  const clients = new Set<http.ServerResponse>();
  const webDist = path.join(ctx.root, 'dist', 'web');

  /** Send a file that must sit inside `base`. Honours byte ranges, so audio can seek and loop. */
  function sendFile(res: http.ServerResponse, base: string, rel: string, cache = 'no-cache', range?: string) {
    const file = path.resolve(base, '.' + path.sep + rel);
    if (file !== base && !file.startsWith(base + path.sep)) return notFound(res, 403);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
        if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'cache-control': cache });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': cache });
      fs.createReadStream(file).pipe(res);
    });
  }
  const notFound = (res: http.ServerResponse, code = 404) => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(code === 403 ? 'forbidden' : 'not found'); };
  const json = (res: http.ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = decodeURIComponent(url.pathname);
    try {
      if (p === '/catalogue.json' || p === '/search.json') return sendFile(res, path.join(ctx.root, 'dist'), p.slice(1), 'no-store');
      if (p.startsWith('/art/')) return sendFile(res, path.join(ctx.root, 'art'), p.slice(5));
      if (p.startsWith('/covers/')) return sendFile(res, path.join(ctx.root, 'covers'), p.slice(8));
      if (p.startsWith('/previews/')) return sendFile(res, path.join(ctx.root, 'previews'), p.slice(10), 'max-age=3600', req.headers.range);
      if (p.startsWith('/sounds/')) return sendFile(res, path.join(ctx.root, 'sounds'), p.slice(8), 'max-age=3600', req.headers.range);
      if (p === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('retry: 1000\n\n');
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      // Pages.
      const page = p === '/' ? '/binder/index.html' : p === '/world' || p === '/world/' ? '/world/index.html' : null;
      if (ctx.vite) {
        if (page) req.url = page + url.search;
        return ctx.vite.middlewares(req, res, () => notFound(res));
      }
      if (page) return sendFile(res, webDist, page);
      return sendFile(res, webDist, p, p.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, { error: 'server error' }, 500);
    }
  });

  return {
    listen: () => new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.listen(ctx.cfg.server.port, '127.0.0.1', () => resolve(`http://127.0.0.1:${ctx.cfg.server.port}/`));
    }),
    /** Tell open pages to refetch. */
    emit(event: string, data: unknown = {}) {
      for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close: () => new Promise<void>(r => { for (const c of clients) c.end(); server.close(() => r()); }),
  };
}
