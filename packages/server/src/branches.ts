import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import parseDiff from 'parse-diff';
import type { Db } from './db.js';
import { git } from './git.js';

async function listLocalBranches(repoPath: string) {
  // name|upstream|headFlag
  const fmt = '%(refname:short)|%(upstream:short)|%(HEAD)';
  const out = await git(['-C', repoPath, 'for-each-ref', 'refs/heads', `--format=${fmt}`]);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, upstream, head] = l.split('|');
      return { name, upstream: upstream || null, isHead: head === '*' };
    });
}

async function branchCommits(repoPath: string, branch: string, base: string, limit: number) {
  const fmt = '%H|%ct|%s';
  // commits reachable from branch but not base
  const out = await git(['-C', repoPath, 'log', `${base}..${branch}`, '-n', String(limit), `--pretty=format:${fmt}`]);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [hash, ts, ...subj] = l.split('|');
      return { hash, ts: Number(ts) * 1000, subject: subj.join('|') };
    });
}

async function branchDiff(repoPath: string, branch: string, base: string) {
  // Use triple-dot for merge-base diff (like GitHub compare)
  const text = await git(['-C', repoPath, 'diff', '--no-color', '--patch', '--unified=3', `${base}...${branch}`]);
  return parseDiff(text);
}

export async function registerBranchApi(app: FastifyInstance, db: Db) {
  app.get('/api/repos/:id/branches', async (req) => {
    const Params = z.object({ id: z.string().min(1) });
    const { id } = Params.parse((req as any).params);
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(id) as any;
    if (!repo) return { error: 'repo_not_found' };

    const branches = await listLocalBranches(repo.path);
    return { repo, branches };
  });

  app.get('/api/repos/:id/branch/commits', async (req) => {
    const Params = z.object({ id: z.string().min(1) });
    const Query = z.object({
      name: z.string().min(1),
      base: z.string().min(1).default('main'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    });

    const { id } = Params.parse((req as any).params);
    const q = Query.parse((req as any).query);

    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(id) as any;
    if (!repo) return { error: 'repo_not_found' };

    const commits = await branchCommits(repo.path, q.name, q.base, q.limit);
    return { commits };
  });

  app.get('/api/repos/:id/branch/diff', async (req) => {
    const Params = z.object({ id: z.string().min(1) });
    const Query = z.object({
      name: z.string().min(1),
      base: z.string().min(1).default('main'),
    });

    const { id } = Params.parse((req as any).params);
    const q = Query.parse((req as any).query);

    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(id) as any;
    if (!repo) return { error: 'repo_not_found' };

    const files = await branchDiff(repo.path, q.name, q.base);
    return { files };
  });
}
