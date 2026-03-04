import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import {
  aheadBehind,
  commit,
  currentBranch,
  lastUpstreamCommitTime,
  pull,
  push,
  stageAll,
} from './git.js';
import { worktreeList } from './git.js';

async function validateWorktreeBelongsToRepo(repoPath: string, worktreePath: string) {
  const wts = await worktreeList(repoPath);
  return wts.some((w) => w.path === worktreePath);
}

export async function registerWorktreeGitApi(app: FastifyInstance, db: Db) {
  app.get('/api/worktree/info', async (req) => {
    const Query = z.object({ repoId: z.string().min(1), worktreePath: z.string().min(1) });
    const q = Query.parse((req as any).query);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(q.repoId) as any;
    if (!repo) return { error: 'repo_not_found' };

    const ok = await validateWorktreeBelongsToRepo(repo.path, q.worktreePath);
    if (!ok) return { error: 'invalid_worktree' };

    const branch = await currentBranch(q.worktreePath);
    const ab = await aheadBehind(q.worktreePath);
    const lastPushTime = await lastUpstreamCommitTime(q.worktreePath);
    return { ok: true, branch, ...ab, lastPushTime };
  });

  app.post('/api/worktree/stage', async (req) => {
    const Body = z.object({ repoId: z.string().min(1), worktreePath: z.string().min(1) });
    const b = Body.parse((req as any).body);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(b.repoId) as any;
    if (!repo) return { error: 'repo_not_found' };
    const ok = await validateWorktreeBelongsToRepo(repo.path, b.worktreePath);
    if (!ok) return { error: 'invalid_worktree' };
    await stageAll(b.worktreePath);
    return { ok: true };
  });

  app.post('/api/worktree/commit', async (req) => {
    const Body = z.object({ repoId: z.string().min(1), worktreePath: z.string().min(1), message: z.string().min(1) });
    const b = Body.parse((req as any).body);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(b.repoId) as any;
    if (!repo) return { error: 'repo_not_found' };
    const ok = await validateWorktreeBelongsToRepo(repo.path, b.worktreePath);
    if (!ok) return { error: 'invalid_worktree' };
    const out = await commit(b.worktreePath, b.message);
    return { ok: true, output: out };
  });

  app.post('/api/worktree/pull', async (req) => {
    const Body = z.object({ repoId: z.string().min(1), worktreePath: z.string().min(1) });
    const b = Body.parse((req as any).body);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(b.repoId) as any;
    if (!repo) return { error: 'repo_not_found' };
    const ok = await validateWorktreeBelongsToRepo(repo.path, b.worktreePath);
    if (!ok) return { error: 'invalid_worktree' };
    const out = await pull(b.worktreePath);
    return { ok: true, output: out };
  });

  app.post('/api/worktree/push', async (req) => {
    const Body = z.object({ repoId: z.string().min(1), worktreePath: z.string().min(1) });
    const b = Body.parse((req as any).body);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(b.repoId) as any;
    if (!repo) return { error: 'repo_not_found' };
    const ok = await validateWorktreeBelongsToRepo(repo.path, b.worktreePath);
    if (!ok) return { error: 'invalid_worktree' };
    const out = await push(b.worktreePath);
    return { ok: true, output: out };
  });
}
