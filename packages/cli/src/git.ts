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

export async function currentBranch(worktreePath: string) {
  const res = await execa('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return res.stdout.trim();
}

export async function hasLocalChanges(worktreePath: string) {
  const res = await execa('git', ['-C', worktreePath, 'status', '--porcelain=v1']);
  return res.stdout.trim().length > 0;
}

export async function createStash(worktreePath: string, message: string) {
  // returns new stash ref (usually stash@{0})
  const res = await execa('git', ['-C', worktreePath, 'stash', 'push', '-u', '-m', message]);
  // if no local changes, git returns "No local changes to save"
  return res.stdout;
}

export async function stashList(worktreePath: string) {
  const res = await execa('git', ['-C', worktreePath, 'stash', 'list']);
  return res.stdout;
}

export async function applyStash(worktreePath: string, stashRef: string) {
  await execa('git', ['-C', worktreePath, 'stash', 'apply', stashRef]);
}

export async function dropStash(worktreePath: string, stashRef: string) {
  await execa('git', ['-C', worktreePath, 'stash', 'drop', stashRef]);
}

export async function checkoutBranch(worktreePath: string, branch: string) {
  // create if missing
  try {
    await execa('git', ['-C', worktreePath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    await execa('git', ['-C', worktreePath, 'checkout', branch]);
  } catch {
    await execa('git', ['-C', worktreePath, 'checkout', '-b', branch]);
  }
}
