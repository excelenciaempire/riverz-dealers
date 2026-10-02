import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const out = path.join(root, 'tmp/riverz-comparison'), publicDir = path.join(root, 'public');
const validatedStatic = path.join(out, 'static');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
function inside(base, relative) {
  const candidate = path.resolve(base, '.' + relative);
  if (!candidate.startsWith(base + path.sep)) throw new Error('invalid_comparison_path');
  return candidate;
}
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:3107');
    if (!['127.0.0.1:3107', 'localhost:3107'].includes(request.headers.host)) { response.writeHead(403); response.end('comparison_host_denied'); return; }
    if (request.method !== 'GET' || url.pathname.startsWith('/api/')) { response.writeHead(403); response.end('comparison_has_no_backend'); return; }
    let file;
    if (url.pathname.startsWith('/assets/')) file = inside(out, decodeURIComponent(url.pathname));
    else if (url.pathname.startsWith('/_next/static/')) file = inside(validatedStatic, decodeURIComponent(url.pathname.slice('/_next/static'.length)));
    else if (url.pathname === '/compare') file = path.join(out, 'compare.html');
    else if (url.pathname === '/' || !path.extname(url.pathname)) file = path.join(out, 'index.html');
    else file = inside(publicDir, decodeURIComponent(url.pathname));
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; form-action 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'" });
    response.end(body);
  } catch { response.writeHead(404); response.end('comparison_asset_unavailable'); }
}).listen(3107, '127.0.0.1', () => console.log('Private isolated comparison: http://127.0.0.1:3107/?stage=comparison&locale=es&page=inbox'));
