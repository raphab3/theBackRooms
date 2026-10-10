import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { api } from '../worker/index.js';
const root = fileURLToPath(new URL('../', import.meta.url)),
  publicDir = resolve(root, 'apps/game/dist');
await mkdir(resolve(root, 'data'), { recursive: true });
const sqlite = new DatabaseSync(resolve(root, 'data/game.sqlite'));
sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
for (const name of (await readdir(resolve(root, 'drizzle')))
  .filter(n => n.endsWith('.sql'))
  .sort()) {
  if (sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) continue;
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(await readFile(resolve(root, 'drizzle', name), 'utf8'));
    sqlite.prepare('INSERT INTO local_migrations VALUES(?)').run(name);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
}
const DB = {
  prepare(sql) {
    const execute = (params = []) => ({
      async first() {
        return sqlite.prepare(sql).get(...params) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...params) };
      },
      async run() {
        return { meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } };
      },
    });
    return {
      ...execute(),
      bind(...params) {
        return execute(params);
      },
    };
  },
};
const port = Number(process.env.PORT || 3000),
  types = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    mp3: 'audio/mpeg',
  };
function localInterfaces() {
  try {
    return networkInterfaces();
  } catch {
    return {};
  }
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost:' + port));
    if (url.pathname.startsWith('/api/')) {
      let body = '',
        bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 262144) {
          res.writeHead(413);
          res.end('Pedido muito grande');
          return;
        }
        body += chunk;
      }
      const response = await api(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}),
        }),
        { DB },
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const path = resolve(
      publicDir,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!path.startsWith(publicDir + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, {
      'Content-Type': types[path.split('.').pop()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end('Não foi possível abrir este recurso.');
    console.error(error.message);
  }
});
server.listen(port, '0.0.0.0', () => {
  console.log('Backrooms: http://localhost:' + port);
  for (const addresses of Object.values(localInterfaces()))
    for (const address of addresses || [])
      if (address.family === 'IPv4' && !address.internal)
        console.log('Na mesma rede: http://' + address.address + ':' + port);
  console.log('Deixe esta janela aberta. Ctrl+C para parar.');
});
