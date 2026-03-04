import Fastify from 'fastify';
import cors from '@fastify/cors';
import { openDb } from './db.js';

const PORT = Number(process.env.GITHANGER_PORT ?? 4545);
const HOST = process.env.GITHANGER_HOST ?? '127.0.0.1';

const db = openDb(process.env.GITHANGER_DB);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true, name: 'githanger-server' }));

app.get('/api/sessions', async () => {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY startedAt DESC').all();
  return { sessions: rows };
});

app.get('/api/sessions/:id/events', async (req) => {
  const { id } = req.params as { id: string };
  const rows = db
    .prepare('SELECT ts, sessionId, kind, message FROM events WHERE sessionId=? ORDER BY ts DESC LIMIT 200')
    .all(id);
  return { events: rows };
});

// TODO (MVP):
// - /api/repos (registered repos)
// - /api/worktrees (discovered + managed)
// - /api/diff?worktreePath=...
// - /api/commits?worktreePath=...

await app.listen({ port: PORT, host: HOST });
app.log.info(`githanger-server listening on http://${HOST}:${PORT}`);
