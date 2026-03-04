import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from './db.js';
import { git } from './git.js';

function isManagedWorktree(repoPath: string, worktreePath: string) {
  const managedRoot = path.join(repoPath, '.worktrees', 'githanger');
  return worktreePath.startsWith(managedRoot + path.sep);
}

export async function registerWorktreeAdminApi(app: FastifyInstance, db: Db) {
  app.post('/api/repos/:id/worktrees/remove', async (req) => {
    const Params = z.object({ id: z.string().min(1) });
    const Body = z.object({ path: z.string().min(1) });

    const { id } = Params.parse((req as any).params);
    const body = Body.parse((req as any).body);

    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(id) as any;
    if (!repo) return { error: 'repo_not_found' };

    if (!isManagedWorktree(repo.path, body.path)) {
      return { error: 'not_managed_worktree', message: 'Only .worktrees/githanger/* worktrees can be removed from the UI for safety.' };
    }

    // Remove worktree directory and clean metadata.
    await git(['-C', repo.path, 'worktree', 'remove', '--force', body.path]);
    await git(['-C', repo.path, 'worktree', 'prune']);

    return { ok: true };
  });
}
