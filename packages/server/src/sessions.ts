import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';

type SessionEvent = { ts: number; kind: string; message: string | null };

export async function registerSessionApi(app: FastifyInstance, db: Db) {
  app.get('/api/sessions2', async (req) => {
    const Query = z.object({ repoPath: z.string().optional() });
    const q = Query.parse((req as any).query);

    const sql = `
      SELECT
        s.*, 
        (SELECT MAX(ts) FROM events e WHERE e.sessionId = s.id) AS lastEventTs
      FROM sessions s
      ${q.repoPath ? 'WHERE s.repoPath = @repoPath' : ''}
      ORDER BY s.startedAt DESC
    `;

    const sessions = db.prepare(sql).all({ repoPath: q.repoPath });
    return { sessions };
  });

  app.get('/api/sessions2/:id', async (req) => {
    const { id } = req.params as { id: string };
    const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    if (!session) return { error: 'session_not_found' };
    const events = db
      .prepare('SELECT ts, kind, message FROM events WHERE sessionId=? ORDER BY ts DESC LIMIT 400')
      .all(id);
    return { session, events };
  });

  app.post('/api/sessions2/:id/chat', async (req) => {
    const { id } = req.params as { id: string };
    const session = db.prepare('SELECT id FROM sessions WHERE id=?').get(id);
    if (!session) return { error: 'session_not_found' };

    const Body = z.object({ message: z.string().min(1).max(5000) });
    const body = Body.parse((req as any).body);

    const payload = JSON.stringify({ role: 'user', text: body.message });
    db.prepare('INSERT INTO events (ts, sessionId, kind, message) VALUES (?, ?, ?, ?)').run(Date.now(), id, 'chat_user', payload);

    return { ok: true };
  });

  app.post('/api/sessions2/:id/approval-required', async (req) => {
    const { id } = req.params as { id: string };
    const session = db.prepare('SELECT id FROM sessions WHERE id=?').get(id);
    if (!session) return { error: 'session_not_found' };

    const Body = z.object({
      requestId: z.string().min(1).optional(),
      title: z.string().min(1).default('Approval required'),
      detail: z.string().optional(),
      meta: z.record(z.any()).optional(),
    });

    const body = Body.parse((req as any).body);
    const payload = JSON.stringify({
      requestId: body.requestId ?? `req_${Date.now()}`,
      title: body.title,
      detail: body.detail ?? '',
      meta: body.meta ?? {},
    });

    db.prepare('INSERT INTO events (ts, sessionId, kind, message) VALUES (?, ?, ?, ?)').run(Date.now(), id, 'approval_required', payload);

    return { ok: true };
  });

  app.post('/api/sessions2/:id/approval', async (req) => {
    const { id } = req.params as { id: string };
    const session = db.prepare('SELECT id FROM sessions WHERE id=?').get(id);
    if (!session) return { error: 'session_not_found' };

    const Body = z.object({
      requestId: z.string().min(1),
      decision: z.enum(['approve', 'reject']),
      note: z.string().optional(),
    });

    const body = Body.parse((req as any).body);
    const payload = JSON.stringify(body);

    db.prepare('INSERT INTO events (ts, sessionId, kind, message) VALUES (?, ?, ?, ?)').run(Date.now(), id, 'approval_decision', payload);

    return { ok: true };
  });

  app.get('/api/sessions2/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = db.prepare('SELECT id FROM sessions WHERE id=?').get(id);
    if (!session) return reply.code(404).send({ error: 'session_not_found' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let lastTs = 0;

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const recent = db
      .prepare('SELECT ts, kind, message FROM events WHERE sessionId=? ORDER BY ts DESC LIMIT 100')
      .all(id) as SessionEvent[];

    const ascRecent = [...recent].reverse();
    for (const e of ascRecent) {
      lastTs = Math.max(lastTs, e.ts);
      send('event', e);
    }

    send('ready', { ok: true });

    const poll = setInterval(() => {
      const rows = db
        .prepare('SELECT ts, kind, message FROM events WHERE sessionId=? AND ts>? ORDER BY ts ASC LIMIT 200')
        .all(id, lastTs) as SessionEvent[];
      for (const e of rows) {
        lastTs = Math.max(lastTs, e.ts);
        send('event', e);
      }
      reply.raw.write(': ping\n\n');
    }, 1200);

    req.raw.on('close', () => {
      clearInterval(poll);
      reply.raw.end();
    });
  });
}
