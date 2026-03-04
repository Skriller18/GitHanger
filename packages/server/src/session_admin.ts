import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from './db.js';
import { git } from './git.js';

function isManagedWorktree(repoPath: string, worktreePath: string) {
  const managedRoot = path.join(repoPath, '.worktrees', 'githanger');
  return worktreePath.startsWith(managedRoot + path.sep);
}

export async function registerSessionAdminApi(app: FastifyInstance, db: Db) {
  app.post('/api/sessions2/:id/terminate', async (req) => {
    const Params = z.object({ id: z.string().min(1) });
    const { id } = Params.parse((req as any).params);

    const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as any;
    if (!session) return { error: 'session_not_found' };

    const pid = session.pid as number | null;
    if (!pid) return { ok: false, error: 'no_pid' };

    let signaled = false;
    try {
      process.kill(pid, 'SIGTERM');
      signaled = true;
    } catch (e: any) {
      return { ok: false, error: 'kill_failed', message: e?.message ?? String(e) };
    }

    // Mark as stopped; if the process is still alive, user can retry.
    db.prepare('UPDATE sessions SET status=?, endedAt=? WHERE id=?').run('stopped', Date.now(), id);
    db.prepare('INSERT INTO events (ts, sessionId, kind, message) VALUES (?, ?, ?, ?)').run(
      Date.now(),
      id,
      'stopped',
      'terminated via dashboard'
    );

    return { ok: true, signaled };
  });

  app.post('/api/sessions2/:id/delete', async (req) => {
    const Params = z.object({ id: z.string().min(1) });
    const Body = z.object({ removeWorktree: z.coerce.boolean().optional().default(true) });
    const { id } = Params.parse((req as any).params);
    const body = Body.parse((req as any).body ?? {});

    const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as any;
    if (!session) return { error: 'session_not_found' };

    // Best-effort: remove managed worktree.
    let worktreeRemoved = false;
    let worktreeRemoveError: string | null = null;

    if (body.removeWorktree) {
      try {
        if (isManagedWorktree(session.repoPath, session.worktreePath)) {
          await git(['-C', session.repoPath, 'worktree', 'remove', '--force', session.worktreePath]);
          await git(['-C', session.repoPath, 'worktree', 'prune']);
          worktreeRemoved = true;
        }
      } catch (e: any) {
        worktreeRemoveError = e?.message ?? String(e);
      }
    }

    db.prepare('DELETE FROM events WHERE sessionId=?').run(id);
    db.prepare('DELETE FROM sessions WHERE id=?').run(id);

    return { ok: true, worktreeRemoved, worktreeRemoveError };
  });
}
