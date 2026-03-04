import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import parseDiff from 'parse-diff';
import { z } from 'zod';
import { commitLog, statusPorcelain, unifiedDiff, worktreeList } from './git.js';
import type { Db } from './db.js';

export async function registerApi(app: FastifyInstance, db: Db) {
  app.get('/api/repos', async () => {
    const repos = db.prepare('SELECT * FROM repos ORDER BY createdAt DESC').all();
    return { repos };
  });

  app.post('/api/repos', async (req) => {
    const Body = z.object({ name: z.string().min(1), path: z.string().min(1) });
    const body = Body.parse((req as any).body);
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO repos (id, name, path, createdAt) VALUES (?, ?, ?, ?)').run(id, body.name, body.path, now);
    return { ok: true, id };
  });

  app.get('/api/repos/:id/worktrees', async (req) => {
    const { id } = req.params as { id: string };
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(id) as any;
    if (!repo) {
      return {
        error: 'repo_not_found',
      };
    }

    const wts = await worktreeList(repo.path);
    // enrich with status summary
    const enriched = await Promise.all(
      wts.map(async (wt) => {
        const status = await statusPorcelain(wt.path);
        const dirtyCount = status ? status.split('\n').filter(Boolean).length : 0;
        const isManaged = wt.path.includes(`${repo.path}/.worktrees/githanger/`);
        return { ...wt, dirtyCount, isManaged };
      })
    );

    return { repo, worktrees: enriched };
  });

  app.get('/api/commits', async (req) => {
    const Query = z.object({ worktreePath: z.string().min(1), limit: z.coerce.number().int().min(1).max(200).optional() });
    const q = Query.parse((req as any).query);
    const commits = await commitLog(q.worktreePath, q.limit ?? 50);
    return { commits };
  });

  app.get('/api/diff', async (req) => {
    const Query = z.object({
      worktreePath: z.string().min(1),
      cached: z.coerce.boolean().optional(),
      base: z.string().optional(),
    });
    const q = Query.parse((req as any).query);
    const text = await unifiedDiff(q.worktreePath, { cached: q.cached, base: q.base });
    const files = parseDiff(text);
    return { files };
  });
}
