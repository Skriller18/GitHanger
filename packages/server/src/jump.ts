import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import type { Db } from './db.js';
import { git } from './git.js';

function meWorktreePath(repoPath: string) {
  return path.join(repoPath, '.worktrees', 'githanger', 'me');
}

async function ensureMeWorktree(repoPath: string) {
  const wtPath = meWorktreePath(repoPath);
  if (fs.existsSync(wtPath) && fs.existsSync(path.join(wtPath, '.git'))) return wtPath;

  await fs.promises.mkdir(path.dirname(wtPath), { recursive: true });
  // create me worktree on current HEAD branch (or detached); we'll just use HEAD.
  await git(['-C', repoPath, 'worktree', 'add', wtPath]);
  return wtPath;
}

async function currentBranch(worktreePath: string) {
  const out = await git(['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return out.trim();
}

async function hasChanges(worktreePath: string) {
  const out = await git(['-C', worktreePath, 'status', '--porcelain=v1']);
  return out.trim().length > 0;
}

async function stashPush(worktreePath: string, msg: string) {
  // stash@{0} becomes the newest; we record that.
  await git(['-C', worktreePath, 'stash', 'push', '-u', '-m', msg]);
  const list = await git(['-C', worktreePath, 'stash', 'list']);
  const first = list.split('\n').find(Boolean) ?? '';
  const m = first.match(/^(stash@\{\d+\}):/);
  return m ? m[1] : null;
}

async function checkout(worktreePath: string, branch: string) {
  // Checkout existing branch or create.
  try {
    await git(['-C', worktreePath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    await git(['-C', worktreePath, 'checkout', branch]);
  } catch {
    await git(['-C', worktreePath, 'checkout', '-b', branch]);
  }
}

async function applyStash(worktreePath: string, stashRef: string) {
  await git(['-C', worktreePath, 'stash', 'apply', stashRef]);
  await git(['-C', worktreePath, 'stash', 'drop', stashRef]);
}

export async function registerJumpApi(app: FastifyInstance, db: Db) {
  app.post('/api/repos/:id/jump', async (req) => {
    const Params = z.object({ id: z.string().min(1) });
    const Body = z.object({ branch: z.string().min(1) });
    const { id } = Params.parse((req as any).params);
    const { branch: targetBranch } = Body.parse((req as any).body);

    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(id) as any;
    if (!repo) return { error: 'repo_not_found' };

    const wtPath = await ensureMeWorktree(repo.path);
    const fromBranch = await currentBranch(wtPath);

    let stashed: { branch: string; stashRef: string } | null = null;

    if (await hasChanges(wtPath)) {
      const msg = `githanger:auto:${fromBranch}:${Date.now()}`;
      const stashRef = await stashPush(wtPath, msg);
      if (stashRef) {
        db.prepare(
          'INSERT INTO branch_stashes (repoPath, branch, stashRef, createdAt) VALUES (?, ?, ?, ?)\n           ON CONFLICT(repoPath, branch) DO UPDATE SET stashRef=excluded.stashRef, createdAt=excluded.createdAt'
        ).run(repo.path, fromBranch, stashRef, Date.now());
        stashed = { branch: fromBranch, stashRef };
      }
    }

    await checkout(wtPath, targetBranch);

    // If we previously stashed changes for this target branch, re-apply now.
    const pending = db.prepare('SELECT stashRef FROM branch_stashes WHERE repoPath=? AND branch=?').get(repo.path, targetBranch) as any;
    let applied = false;
    let applyError: string | null = null;
    if (pending?.stashRef) {
      try {
        await applyStash(wtPath, pending.stashRef);
        db.prepare('DELETE FROM branch_stashes WHERE repoPath=? AND branch=?').run(repo.path, targetBranch);
        applied = true;
      } catch (e: any) {
        applyError = e?.message ?? String(e);
      }
    }

    return {
      ok: true,
      meWorktreePath: wtPath,
      fromBranch,
      toBranch: targetBranch,
      stashed,
      applied,
      applyError,
    };
  });
}
