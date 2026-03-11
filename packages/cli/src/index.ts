#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execa } from 'execa';
import { z } from 'zod';

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

const ProviderSchema = z.enum(['claude', 'codex']);

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

    const interactiveAgent = /(^|\/)claude$|(^|\/)codex$/i.test(cmd);
    const agentEnv = {
      ...process.env,
      GITHANGER_SESSION_ID: sessionId,
      GITHANGER_PROVIDER: provider,
      GITHANGER_REPO: repoPath,
      GITHANGER_WORKTREE: worktreePath,
      GITHANGER_BRANCH: branch,
    };

    const outToEvent = createLineBuffer((line) => {
      insertEvent.run(
        Date.now(),
        sessionId,
        'chat_agent',
        JSON.stringify({ role: 'agent', text: line })
      );
    });

    let controlPump: NodeJS.Timeout | null = null;
    let waitForExit: Promise<{ exitCode: number | null }>;
    let writeToAgent: ((text: string) => void) | null = null;

    if (interactiveAgent) {
      // Preferred path: PTY for interactive CLIs + output capture + dashboard input bridge.
      try {
        const pty = await import('node-pty');
        const ptyProc = pty.spawn(cmd, cmdArgs, {
          name: 'xterm-color',
          cols: process.stdout.columns || 120,
          rows: process.stdout.rows || 30,
          cwd: worktreePath,
          env: agentEnv as Record<string, string>,
        });

        db.prepare('UPDATE sessions SET pid=? WHERE id=?').run(ptyProc.pid ?? null, sessionId);
        insertEvent.run(Date.now(), sessionId, 'system', 'transport=node-pty (interactive + bridged)');

        ptyProc.onData((data: string) => {
          process.stdout.write(data);
          outToEvent(data);
        });

        writeToAgent = (text: string) => {
          ptyProc.write(text);
        };

        waitForExit = new Promise((resolve) => {
          ptyProc.onExit((e: { exitCode: number }) => resolve({ exitCode: e.exitCode }));
        });
      } catch (err: any) {
        // Fallback path if node-pty is unavailable on this host.
        insertEvent.run(
          Date.now(),
          sessionId,
          'system',
          `node-pty unavailable; fallback=inherit (${String(err?.message ?? err)})`
        );

        const child = execa(cmd, cmdArgs, {
          cwd: worktreePath,
          env: agentEnv,
          stdio: 'inherit',
        });

        db.prepare('UPDATE sessions SET pid=? WHERE id=?').run(child.pid ?? null, sessionId);
        waitForExit = child.then((res) => ({ exitCode: res.exitCode ?? 0 }));
        writeToAgent = null;
      }
    } else {
      const child = execa(cmd, cmdArgs, {
        cwd: worktreePath,
        env: agentEnv,
        stdio: 'pipe',
      });

      db.prepare('UPDATE sessions SET pid=? WHERE id=?').run(child.pid ?? null, sessionId);

      child.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk);
        outToEvent(chunk);
      });

      child.stderr?.on('data', (chunk) => {
        process.stderr.write(chunk);
        outToEvent(chunk);
      });

      writeToAgent = (text: string) => {
        if (!child.stdin || child.stdin.destroyed) return;
        child.stdin.write(text);
      };

      waitForExit = child.then((res) => ({ exitCode: res.exitCode ?? 0 }));
    }

    // Poll control events from DB and forward to the running agent process.
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
        if (!writeToAgent) continue;

        if (row.kind === 'chat_user') {
          try {
            const payload = row.message ? JSON.parse(row.message) : null;
            const text = String(payload?.text ?? '').trim();
            if (text) writeToAgent(`${text}\n`);
          } catch {
            const text = String(row.message ?? '').trim();
            if (text) writeToAgent(`${text}\n`);
          }
        }

        if (row.kind === 'approval_decision') {
          try {
            const payload = row.message ? JSON.parse(row.message) : null;
            const decision = String(payload?.decision ?? '').trim();
            const note = String(payload?.note ?? '').trim();
            if (decision) {
              const line = note ? `[approval:${decision}] ${note}` : `[approval:${decision}]`;
              writeToAgent(`${line}\n`);
            }
          } catch {
            // no-op on malformed approval payload
          }
        }
      }
    }, 800);

    const heartbeat = setInterval(() => {
      insertEvent.run(Date.now(), sessionId, 'heartbeat', 'running');
    }, 5000);

    try {
      const res = await waitForExit;
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
  .description('Run the local GitHanger server (API) from a GitHanger source checkout.')
  .option('--port <port>', 'Port (default 4545)')
  .action(async (opts) => {
    const port = String(opts.port ?? '4545');
    const serverEntry = path.resolve(process.cwd(), 'packages/server/dist/index.js');
    if (!fs.existsSync(serverEntry)) {
      throw new Error(
        'Server build not found. Run this from the GitHanger repo root after `npm run build`.'
      );
    }

    await execa('node', [serverEntry], {
      stdio: 'inherit',
      env: { ...process.env, GITHANGER_PORT: port },
    });
  });

program
  .command('start')
  .description('Start API server + web dashboard from a GitHanger source checkout.')
  .action(async () => {
    const rootPkg = path.resolve(process.cwd(), 'package.json');
    if (!fs.existsSync(rootPkg)) {
      throw new Error(
        'No package.json in current directory. Run this from the GitHanger repo root.'
      );
    }
    await execa('npm', ['run', 'start'], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  });

await program.parseAsync(process.argv);
