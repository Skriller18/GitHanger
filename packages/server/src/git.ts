import { execa } from 'execa';

export async function git(args: string[], opts?: { cwd?: string }) {
  const res = await execa('git', args, { cwd: opts?.cwd, all: true });
  return res.all;
}

export async function worktreeList(repoPath: string) {
  const out = await git(['-C', repoPath, 'worktree', 'list', '--porcelain']);
  // porcelain format: blocks separated by blank line
  const blocks = out.trim().split(/\n\n+/g).map((b) => b.trim()).filter(Boolean);
  const worktrees = blocks.map((block) => {
    const lines = block.split('\n');
    const obj: any = { path: '', branch: null as string | null, head: null as string | null, locked: false, prunable: false };
    for (const line of lines) {
      const [k, ...rest] = line.split(' ');
      const v = rest.join(' ');
      if (k === 'worktree') obj.path = v;
      else if (k === 'branch') obj.branch = v.replace('refs/heads/', '');
      else if (k === 'HEAD') obj.head = v;
      else if (k === 'locked') obj.locked = true;
      else if (k === 'prunable') obj.prunable = true;
    }
    return obj as {
      path: string;
      branch: string | null;
      head: string | null;
      locked: boolean;
      prunable: boolean;
    };
  });
  return worktrees;
}

export async function statusPorcelain(worktreePath: string) {
  return await git(['-C', worktreePath, 'status', '--porcelain=v1']);
}

export async function currentBranch(worktreePath: string) {
  const out = await git(['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return out.trim();
}

export async function upstream(worktreePath: string) {
  try {
    const out = await git(['-C', worktreePath, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return out.trim();
  } catch {
    return null;
  }
}

export async function aheadBehind(worktreePath: string) {
  const u = await upstream(worktreePath);
  if (!u) return { upstream: null as string | null, ahead: 0, behind: 0 };
  const out = await git(['-C', worktreePath, 'rev-list', '--left-right', '--count', `${u}...HEAD`]);
  const [behindStr, aheadStr] = out.trim().split(/\s+/);
  return { upstream: u, ahead: Number(aheadStr ?? 0), behind: Number(behindStr ?? 0) };
}

export async function lastUpstreamCommitTime(worktreePath: string) {
  const u = await upstream(worktreePath);
  if (!u) return null;
  try {
    const out = await git(['-C', worktreePath, 'log', '-1', `--format=%ct`, u]);
    const ts = Number(out.trim());
    return Number.isFinite(ts) && ts > 0 ? ts * 1000 : null;
  } catch {
    return null;
  }
}

export async function stageAll(worktreePath: string) {
  await git(['-C', worktreePath, 'add', '-A']);
}

export async function commit(worktreePath: string, message: string) {
  return await git(['-C', worktreePath, 'commit', '-m', message]);
}

export async function pull(worktreePath: string) {
  return await git(['-C', worktreePath, 'pull']);
}

export async function push(worktreePath: string) {
  return await git(['-C', worktreePath, 'push']);
}

export async function commitLog(worktreePath: string, limit = 50, skip = 0) {
  // hash|ts|subject
  const fmt = '%H|%ct|%s';
  const args = ['-C', worktreePath, 'log', `-n`, String(limit), `--pretty=format:${fmt}`];
  if (skip > 0) args.push('--skip', String(skip));
  const out = await git(args);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [hash, ts, ...subj] = l.split('|');
      return { hash, ts: Number(ts) * 1000, subject: subj.join('|') };
    });
}

export async function unifiedDiff(
  worktreePath: string,
  params: { cached?: boolean; base?: string; includeUntracked?: boolean } = {}
) {
  const args = ['-C', worktreePath, 'diff', '--no-color', '--patch', '--unified=3'];
  if (params.cached) args.push('--cached');
  if (params.base) args.push(params.base);
  let text = await git(args);

  // `git diff` does NOT include untracked files. If requested, synthesize diffs for them.
  if (!params.cached && params.includeUntracked) {
    const status = await git(['-C', worktreePath, 'status', '--porcelain=v1']);
    const untracked = status
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.startsWith('?? '))
      .map((l) => l.slice(3));

    for (const p of untracked) {
      // Show new file as diff from /dev/null.
      try {
        const u = await git([
          '-C',
          worktreePath,
          'diff',
          '--no-color',
          '--patch',
          '--unified=3',
          '--no-index',
          '--',
          '/dev/null',
          p,
        ]);
        if (u.trim()) {
          text += (text.endsWith('\n') ? '' : '\n') + u + '\n';
        }
      } catch {
        // best-effort; ignore errors for binary/permission issues
      }
    }
  }

  return text;
}
