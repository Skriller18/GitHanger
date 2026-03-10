#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execa } from 'execa';
import { ProviderSchema } from '@githanger/shared';

function createLineBuffer(onLine: (line: string) => void) {
  let buffer = '';
  return (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const text = line.trim();
      if (text) onLine(text);
    }
  };
}
import { openDb } from './db.js';
import { ensureWorktree } from './git.js';

const program = new Command();

program
  .name('githanger')
  .description('GitHanger: local agent+git dashboard for branches/worktrees + agent sessions')
  .version('0.1.0');

program
  .command('init')
  .description('Register a repo for GitHanger to track (branches + worktrees).')
  .option('--repo <path>', 'Path to git repository (default: cwd)')
  .option('--name <name>', 'Display name (default: folder name)')
  .action(async (opts) => {
    const repoPath = path.resolve(opts.repo ?? process.cwd());
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      throw new Error(`Not a git repo: ${repoPath}`);
    }
    const name = String(opts.name ?? path.basename(repoPath));

    const db = openDb(process.env.GITHANGER_DB);
    const id = crypto.randomUUID();
    const now = Date.now();

    // idempotent-ish: if path exists, do nothing.
    const existing = db.prepare('SELECT id FROM repos WHERE path=?').get(repoPath) as any;
    if (existing?.id) {
      console.log(`Repo already registered: ${repoPath} (id=${existing.id})`);
      return;
    }

    db.prepare('INSERT INTO repos (id, name, path, createdAt) VALUES (?, ?, ?, ?)').run(id, name, repoPath, now);
    console.log(`Registered repo: ${name} -> ${repoPath} (id=${id})`);
  });

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

    // Claude/Codex CLIs are interactive TTY apps. Running them with fully piped stdio
    // can make them appear "stuck". If we have a TTY, prefer inherit mode.
    const interactiveAgent = /(^|\/)claude$|(^|\/)codex$/i.test(cmd);
    const useTtyInherit = interactiveAgent && Boolean(process.stdin.isTTY && process.stdout.isTTY);

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
      stdio: useTtyInherit ? 'inherit' : 'pipe',
    });

    db.prepare('UPDATE sessions SET pid=? WHERE id=?').run(child.pid ?? null, sessionId);

    let controlPump: NodeJS.Timeout | null = null;

    if (useTtyInherit) {
      insertEvent.run(Date.now(), sessionId, 'system', 'stdio=inherit (TTY mode)');
    } else {
      const outToEvent = createLineBuffer((line) => {
        insertEvent.run(
          Date.now(),
          sessionId,
          'chat_agent',
          JSON.stringify({ role: 'agent', text: line })
        );
      });

      child.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk);
        outToEvent(chunk);
      });

      child.stderr?.on('data', (chunk) => {
        process.stderr.write(chunk);
        outToEvent(chunk);
      });

      // Poll control events from DB and forward to the running agent process.
      // This is intentionally simple and local-first for MVP reliability.
      let lastControlEventId = 0;
      controlPump = setInterval(() => {
        const rows = db
          .prepare(
            `SELECT id, kind, message
             FROM events
             WHERE sessionId = ? AND id > ? AND kind IN ('chat_user', 'approval_decision')
             ORDER BY id ASC`
          )
          .all(sessionId, lastControlEventId) as Array<{ id: number; kind: string; message: string | null }>;

        for (const row of rows) {
          lastControlEventId = Math.max(lastControlEventId, row.id);

          if (!child.stdin || child.stdin.destroyed) continue;

          if (row.kind === 'chat_user') {
            try {
              const payload = row.message ? JSON.parse(row.message) : null;
              const text = String(payload?.text ?? '').trim();
              if (text) child.stdin.write(`${text}\n`);
            } catch {
              const text = String(row.message ?? '').trim();
              if (text) child.stdin.write(`${text}\n`);
            }
          }

          if (row.kind === 'approval_decision') {
            try {
              const payload = row.message ? JSON.parse(row.message) : null;
              const decision = String(payload?.decision ?? '').trim();
              const note = String(payload?.note ?? '').trim();
              if (decision) {
                const line = note ? `[approval:${decision}] ${note}` : `[approval:${decision}]`;
                child.stdin.write(`${line}\n`);
              }
            } catch {
              // no-op on malformed approval payload
            }
          }
        }
      }, 800);
    }

    const heartbeat = setInterval(() => {
      insertEvent.run(Date.now(), sessionId, 'heartbeat', 'running');
    }, 5000);

    try {
      const res = await child;
      if (controlPump) clearInterval(controlPump);
      clearInterval(heartbeat);
      insertEvent.run(Date.now(), sessionId, 'stopped', `exit=${res.exitCode}`);
      db.prepare('UPDATE sessions SET status=?, endedAt=? WHERE id=?').run('stopped', Date.now(), sessionId);
      process.exit(res.exitCode ?? 0);
    } catch (err: any) {
      if (controlPump) clearInterval(controlPump);
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

program
  .command('start')
  .description('Start API server + web dashboard (run from GitHanger repo root).')
  .action(async () => {
    // Assumes you are in the GitHanger repo root where package.json has the start script.
    await execa('npm', ['run', 'start'], { stdio: 'inherit' });
  });

await program.parseAsync(process.argv);
