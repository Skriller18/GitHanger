import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.GITHANGER_WEB_ROOT;
const apiBase = process.env.GITHANGER_API_BASE ?? 'http://127.0.0.1:4545';
const port = Number(process.env.GITHANGER_WEB_PORT ?? '5173');

if (!root) {
  throw new Error('GITHANGER_WEB_ROOT is required');
}

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || !path.extname(file)) file = path.join(root, 'index.html');

  fs.readFile(file, (err, buf) => {
    if (err) {
      fs.readFile(path.join(root, 'index.html'), (err2, html) => {
        if (err2) {
          res.statusCode = 500;
          res.end(String(err2));
          return;
        }
        const text = html.toString().replace('http://127.0.0.1:4545', apiBase);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(text);
      });
      return;
    }

    if (path.basename(file) === 'index.html') {
      const text = buf.toString().replace('http://127.0.0.1:4545', apiBase);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(text);
      return;
    }

    res.setHeader('content-type', types.get(path.extname(file)) || 'application/octet-stream');
    res.end(buf);
  });
});

server.listen(port, '127.0.0.1');
