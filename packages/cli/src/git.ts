import { execa } from 'execa';

export async function git(args: string[], opts?: { cwd?: string }) {
  const res = await execa('git', args, { cwd: opts?.cwd, all: true });
  return res;
}

export async function ensureWorktree(params: {
  repoPath: string;
  worktreePath: string;
  branch: string;
}) {
  const { repoPath, worktreePath, branch } = params;

  // If worktree already exists, nothing to do.
  try {
    await execa('git', ['-C', worktreePath, 'rev-parse', '--is-inside-work-tree']);
    return;
  } catch {
    // continue
  }

  // Determine whether branch exists.
  let branchExists = false;
  try {
    await execa('git', ['-C', repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    await execa('git', ['-C', repoPath, 'worktree', 'add', worktreePath, branch]);
  } else {
    await execa('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath]);
  }
}
