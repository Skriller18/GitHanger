import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';

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
}
