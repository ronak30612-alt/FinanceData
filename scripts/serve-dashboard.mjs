import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const ROOT = path.resolve('docs');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
    const safePath = requestUrl.pathname === '/'
      ? '/index.html'
      : requestUrl.pathname;
    const filePath = path.join(ROOT, safePath);
    const resolved = path.resolve(filePath);

    if (!resolved.startsWith(ROOT)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const stat = await fs.stat(resolved).catch(() => null);
    const targetPath = stat?.isDirectory() ? path.join(resolved, 'index.html') : resolved;
    const content = await fs.readFile(targetPath);
    const contentType = MIME_TYPES[path.extname(targetPath)] ?? 'application/octet-stream';

    response.writeHead(200, { 'Content-Type': contentType });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard preview: http://${HOST}:${PORT}`);
});
