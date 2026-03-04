import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { git, worktreeList } from './git.js';

async function validateWorktreeBelongsToRepo(repoPath: string, worktreePath: string) {
  const wts = await worktreeList(repoPath);
  return wts.some((w) => w.path === worktreePath);
}

export async function registerWorktreeFileApi(app: FastifyInstance, db: Db) {
  app.post('/api/worktree/unstage', async (req) => {
    const Body = z.object({ repoId: z.string().min(1), worktreePath: z.string().min(1), file: z.string().min(1) });
    const b = Body.parse((req as any).body);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(b.repoId) as any;
    if (!repo) return { error: 'repo_not_found' };
    const ok = await validateWorktreeBelongsToRepo(repo.path, b.worktreePath);
    if (!ok) return { error: 'invalid_worktree' };

    await git(['-C', b.worktreePath, 'restore', '--staged', '--', b.file]);
    return { ok: true };
  });

  app.post('/api/worktree/discard', async (req) => {
    const Body = z.object({ repoId: z.string().min(1), worktreePath: z.string().min(1), file: z.string().min(1), kind: z.enum(['tracked', 'untracked']).optional() });
    const b = Body.parse((req as any).body);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(b.repoId) as any;
    if (!repo) return { error: 'repo_not_found' };
    const ok = await validateWorktreeBelongsToRepo(repo.path, b.worktreePath);
    if (!ok) return { error: 'invalid_worktree' };

    if (b.kind === 'untracked') {
      // delete the file from disk
      await git(['-C', b.worktreePath, 'clean', '-f', '--', b.file]);
    } else {
      // discard both working tree + staged changes for that file
      await git(['-C', b.worktreePath, 'restore', '--staged', '--worktree', '--', b.file]);
    }

    return { ok: true };
  });
}
