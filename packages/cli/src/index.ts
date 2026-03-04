#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execa } from 'execa';
import { ProviderSchema } from '@githanger/shared';
import { openDb } from './db.js';
import { ensureWorktree } from './git.js';

const program = new Command();

program
  .name('githanger')
  .description('GitHanger: local agent+git dashboard for branches/worktrees + agent sessions')
  .version('0.1.0');

program
  .command('run')
  .description('Start a tracked agent session in its own worktree (interactive).')
  .option('--repo <path>', 'Path to git repository (default: cwd)')
  .option('--branch <name>', 'Branch name to bind this session to')
  .option('--name <name>', 'Session name')
  .option('--provider <claude|codex>', 'Agent provider')
  .action(async (opts) => {
    const repoPath = path.resolve(opts.repo ?? process.cwd());
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      throw new Error(`Not a git repo: ${repoPath}`);
    }

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Which agent provider?',
        choices: [
          { name: 'Claude Code', value: 'claude' },
          { name: 'Codex', value: 'codex' },
        ],
        when: () => !opts.provider,
      },
      {
        type: 'input',
        name: 'name',
        message: 'Name this agent session (e.g. alice-fix-auth):',
        when: () => !opts.name,
        validate: (v: string) => (v.trim().length ? true : 'Please enter a name'),
      },
      {
        type: 'input',
        name: 'branch',
        message: 'Branch to work on (e.g. agent/alice/fix-auth):',
        when: () => !opts.branch,
        validate: (v: string) => (v.trim().length ? true : 'Please enter a branch'),
      },
      {
        type: 'input',
        name: 'cmd',
        message: 'Command to run (binary name on PATH):',
        default: (prev: any) => (prev.provider === 'codex' ? 'codex' : 'claude'),
      },
      {
        type: 'input',
        name: 'cmdArgs',
        message: 'Arguments (optional, space-separated):',
        default: '',
      },
    ]);

    const provider = ProviderSchema.parse(opts.provider ?? answers.provider);
    const name = String(opts.name ?? answers.name).trim();
    const branch = String(opts.branch ?? answers.branch).trim();

    const cmd = String(answers.cmd).trim();
    const cmdArgs = String(answers.cmdArgs ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const sessionId = crypto.randomUUID();
    const safeName = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-');
    const worktreePath = path.join(repoPath, '.worktrees', 'githanger', safeName);

    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });
    await ensureWorktree({ repoPath, worktreePath, branch });

    const db = openDb(process.env.GITHANGER_DB);
    const now = Date.now();

    db.prepare(
      `INSERT INTO sessions (id, name, provider, repoPath, worktreePath, branch, pid, status, startedAt, endedAt)
       VALUES (@id, @name, @provider, @repoPath, @worktreePath, @branch, @pid, @status, @startedAt, @endedAt)`
    ).run({
      id: sessionId,
      name,
      provider,
      repoPath,
      worktreePath,
      branch,
      pid: null,
      status: 'running',
      startedAt: now,
      endedAt: null,
    });

    const insertEvent = db.prepare(
      `INSERT INTO events (ts, sessionId, kind, message) VALUES (?, ?, ?, ?)`
    );
    insertEvent.run(now, sessionId, 'started', `${provider}:${name} on ${branch}`);

    // Spawn agent, record stdout/stderr events, but still print to your terminal.
    const child = execa(cmd, cmdArgs, {
      cwd: worktreePath,
      env: {
        ...process.env,
        GITHANGER_SESSION_ID: sessionId,
        GITHANGER_PROVIDER: provider,
        GITHANGER_REPO: repoPath,
        GITHANGER_WORKTREE: worktreePath,
        GITHANGER_BRANCH: branch,
      },
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'inherit',
    });

    db.prepare('UPDATE sessions SET pid=? WHERE id=?').run(child.pid ?? null, sessionId);

    const writeLine = (kind: 'stdout' | 'stderr') => (buf: Buffer) => {
      const text = buf.toString('utf8');
      process[kind === 'stdout' ? 'stdout' : 'stderr'].write(text);
      insertEvent.run(Date.now(), sessionId, kind, text.slice(-4000));
    };

    child.stdout?.on('data', writeLine('stdout'));
    child.stderr?.on('data', writeLine('stderr'));

    const heartbeat = setInterval(() => {
      insertEvent.run(Date.now(), sessionId, 'heartbeat', 'running');
    }, 5000);

    try {
      const res = await child;
      clearInterval(heartbeat);
      insertEvent.run(Date.now(), sessionId, 'stopped', `exit=${res.exitCode}`);
      db.prepare('UPDATE sessions SET status=?, endedAt=? WHERE id=?').run('stopped', Date.now(), sessionId);
      process.exit(res.exitCode ?? 0);
    } catch (err: any) {
      clearInterval(heartbeat);
      insertEvent.run(Date.now(), sessionId, 'crashed', String(err?.shortMessage ?? err?.message ?? err));
      db.prepare('UPDATE sessions SET status=?, endedAt=? WHERE id=?').run('crashed', Date.now(), sessionId);
      process.exit(typeof err?.exitCode === 'number' ? err.exitCode : 1);
    }
  });

program
  .command('serve')
  .description('Run the local GitHanger server (API).')
  .option('--port <port>', 'Port (default 4545)')
  .action(async (opts) => {
    const port = String(opts.port ?? '4545');
    await execa('node', ['../../packages/server/dist/index.js'], {
      stdio: 'inherit',
      env: { ...process.env, GITHANGER_PORT: port },
    });
  });

await program.parseAsync(process.argv);
