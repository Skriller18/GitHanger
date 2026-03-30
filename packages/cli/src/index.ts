#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
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
import { ensureWorktree, git } from './git.js';

const ProviderSchema = z.enum(['claude', 'codex', 'copilot', 'opencode']);
const DEFAULT_PORT = Number(process.env.GITHANGER_PORT ?? 4545);
const DEFAULT_HOST = process.env.GITHANGER_HOST ?? '127.0.0.1';
const DEFAULT_WEB_PORT = Number(process.env.GITHANGER_WEB_PORT ?? 5173);

const program = new Command();

function resolveDataDir() {
  return path.join(os.homedir(), '.githanger');
}

function resolvePidFile() {
  return path.join(resolveDataDir(), 'start-state.json');
}

function resolveRuntimeLog(name: string) {
  return path.join(resolveDataDir(), `${name}.log`);
}

function parsePid(raw: string | undefined | null) {
  const value = Number(raw ?? '');
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isPidRunning(pid: number | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHttp(url: string, timeoutMs = 20000) {
  const started = Date.now();
  let lastError = 'unknown';

  while (Date.now() - started < timeoutMs) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve((res.statusCode ?? 500) < 500);
        });
        req.on('error', (err) => {
          lastError = err.message;
          resolve(false);
        });
        req.setTimeout(2000, () => {
          lastError = 'timeout';
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

async function loadStartState() {
  const pidFile = resolvePidFile();
  try {
    const raw = await fs.promises.readFile(pidFile, 'utf8');
    const parsed = JSON.parse(raw) as {
      root?: string;
      startedAt?: number;
      serverPid?: number;
      webPid?: number;
      port?: number;
      webPort?: number;
    };
    return parsed;
  } catch {
    return null;
  }
}

async function saveStartState(state: {
  root: string;
  startedAt: number;
  serverPid: number | null;
  webPid: number | null;
  port: number;
  webPort: number;
}) {
  const pidFile = resolvePidFile();
  await fs.promises.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.promises.writeFile(pidFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function clearStartState() {
  const pidFile = resolvePidFile();
  try {
    await fs.promises.unlink(pidFile);
  } catch {
    // ignore
  }
}

async function detectRepoRoot(startDir: string) {
  let dir = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = await fs.promises.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string; workspaces?: unknown };
        if (pkg.name === 'githanger' && Array.isArray(pkg.workspaces)) return dir;
      } catch {
        // ignore malformed package.json and keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function findInstalledBundleRoots(cliDir: string) {
  const webCandidates = [
    path.resolve(cliDir, '../vendor/web-dist'),
    path.resolve(cliDir, '../../web/dist'),
    path.resolve(cliDir, '../web/dist'),
    path.resolve(cliDir, '../../../web/dist'),
  ];
  const serverCandidates = [
    path.resolve(cliDir, '../vendor/server-dist'),
    path.resolve(cliDir, '../../server/dist'),
    path.resolve(cliDir, '../server/dist'),
    path.resolve(cliDir, '../../../server/dist'),
  ];

  const webRoot = webCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? null;
  const serverRoot = serverCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.js'))) ?? null;

  return { webRoot, serverRoot };
}

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
  .option('--provider <claude|codex|copilot|opencode>', 'Agent provider')
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
          { name: 'GitHub Copilot', value: 'copilot' },
          { name: 'OpenCode', value: 'opencode' },
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
        default: (prev: any) => {
          if (prev.provider === 'codex') return 'codex';
          if (prev.provider === 'copilot') return 'copilot';
          if (prev.provider === 'opencode') return 'opencode';
          return 'claude';
        },
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

    const interactiveAgent = /(^|\/)claude$|(^|\/)codex$|(^|\/)copilot$|(^|\/)opencode$/i.test(cmd);
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
  .description('Start the API server + dashboard, either from an installed package or a source checkout.')
  .option('--port <port>', 'API port (default 4545)')
  .option('--host <host>', 'API host (default 127.0.0.1)')
  .option('--web-port <port>', 'Dashboard port (default 5173)')
  .action(async (opts) => {
    const root = await detectRepoRoot(process.cwd());
    const cliDir = path.dirname(new URL(import.meta.url).pathname);
    const { webRoot: webDist, serverRoot: bundledServerRoot } = await findInstalledBundleRoots(cliDir);
    const port = Number(opts.port ?? DEFAULT_PORT);
    const host = String(opts.host ?? DEFAULT_HOST);
    const webPort = Number(opts.webPort ?? DEFAULT_WEB_PORT);

    if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid --port: ${opts.port}`);
    if (!Number.isFinite(webPort) || webPort <= 0) throw new Error(`Invalid --web-port: ${opts.webPort}`);

    const existing = await loadStartState();
    if (existing) {
      const serverAlive = isPidRunning(existing.serverPid ?? null);
      const webAlive = isPidRunning(existing.webPid ?? null);
      if (serverAlive && webAlive) {
        console.log(`GitHanger already running:`);
        console.log(`- API:  http://${host}:${existing.port ?? port}`);
        console.log(`- Web:  http://127.0.0.1:${existing.webPort ?? webPort}`);
        console.log(`- PIDs: server=${existing.serverPid}, web=${existing.webPid}`);
        return;
      }
      await clearStartState();
    }

    await fs.promises.mkdir(resolveDataDir(), { recursive: true });

    if (root) {
      const serverEntry = path.join(root, 'packages/server/dist/index.js');
      const webEntry = path.join(root, 'packages/web');
      if (!fs.existsSync(serverEntry)) {
        throw new Error('Server build not found. Run `npm run build` once in the GitHanger repo before `githanger start`.');
      }

      const serverProc = execa('node', [serverEntry], {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GITHANGER_PORT: String(port), GITHANGER_HOST: host },
      });
      serverProc.unref();
      serverProc.stdout?.pipe(fs.createWriteStream(resolveRuntimeLog('server'), { flags: 'a' }));
      serverProc.stderr?.pipe(fs.createWriteStream(resolveRuntimeLog('server'), { flags: 'a' }));

      const webProc = execa('npm', ['run', '-w', '@githanger/web', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, VITE_API_BASE: `http://${host}:${port}` },
      });
      webProc.unref();
      webProc.stdout?.pipe(fs.createWriteStream(resolveRuntimeLog('web'), { flags: 'a' }));
      webProc.stderr?.pipe(fs.createWriteStream(resolveRuntimeLog('web'), { flags: 'a' }));

      await waitForHttp(`http://${host}:${port}/health`);
      await waitForHttp(`http://127.0.0.1:${webPort}`);
      await saveStartState({
        root,
        startedAt: Date.now(),
        serverPid: serverProc.pid ?? null,
        webPid: webProc.pid ?? null,
        port,
        webPort,
      });

      console.log('GitHanger started from source checkout.');
      console.log(`- API:  http://${host}:${port}`);
      console.log(`- Web:  http://127.0.0.1:${webPort}`);
      console.log(`- Logs: ${resolveRuntimeLog('server')} | ${resolveRuntimeLog('web')}`);
      return;
    }

    if (!webDist) {
      throw new Error('No source checkout detected and bundled dashboard assets were not found. Reinstall the package or run from the GitHanger repo root.');
    }

    if (!bundledServerRoot) {
      throw new Error('Bundled server assets were not found in the installed package. Reinstall the package or rebuild before publishing.');
    }

    const bundledServerEntry = path.join(bundledServerRoot, 'index.js');
    const serverProc = execa('node', [bundledServerEntry], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHANGER_HOST: host, GITHANGER_PORT: String(port) },
    });
    serverProc.unref();
    serverProc.stdout?.pipe(fs.createWriteStream(resolveRuntimeLog('server'), { flags: 'a' }));
    serverProc.stderr?.pipe(fs.createWriteStream(resolveRuntimeLog('server'), { flags: 'a' }));

    const webServerEntry = path.resolve(cliDir, '../src/web_server_template.mjs');
    const webProc = execa('node', [webServerEntry], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GITHANGER_WEB_ROOT: webDist,
        GITHANGER_API_BASE: `http://${host}:${port}`,
        GITHANGER_WEB_PORT: String(webPort),
      },
    });
    webProc.unref();
    webProc.stdout?.pipe(fs.createWriteStream(resolveRuntimeLog('web'), { flags: 'a' }));
    webProc.stderr?.pipe(fs.createWriteStream(resolveRuntimeLog('web'), { flags: 'a' }));

    await waitForHttp(`http://${host}:${port}/health`);
    await waitForHttp(`http://127.0.0.1:${webPort}`);
    await saveStartState({
      root: webDist,
      startedAt: Date.now(),
      serverPid: serverProc.pid ?? null,
      webPid: webProc.pid ?? null,
      port,
      webPort,
    });

    console.log('GitHanger started from installed package.');
    console.log(`- API:  http://${host}:${port}`);
    console.log(`- Web:  http://127.0.0.1:${webPort}`);
    console.log(`- Logs: ${resolveRuntimeLog('server')} | ${resolveRuntimeLog('web')}`);
  });

program
  .command('status')
  .description('Show tracked agent sessions and their current status.')
  .action(async () => {
    const db = openDb(process.env.GITHANGER_DB);
    const sessions = db
      .prepare(
        `SELECT s.*, (
           SELECT MAX(ts) FROM events e WHERE e.sessionId = s.id
         ) AS lastEventTs
         FROM sessions s
         ORDER BY startedAt DESC`
      )
      .all() as Array<any>;

    if (!sessions.length) {
      console.log('No tracked GitHanger agent sessions yet.');
      return;
    }

    for (const session of sessions) {
      const lastSeen = session.lastEventTs ? new Date(session.lastEventTs).toLocaleString() : 'never';
      const pidState = session.pid ? (isPidRunning(session.pid) ? 'alive' : 'gone') : 'n/a';
      console.log(`${session.status.padEnd(8)} ${session.name} (${session.provider})`);
      console.log(`  branch:   ${session.branch}`);
      console.log(`  repo:     ${session.repoPath}`);
      console.log(`  worktree: ${session.worktreePath}`);
      console.log(`  pid:      ${session.pid ?? '—'} (${pidState})`);
      console.log(`  last:     ${lastSeen}`);
      console.log('');
    }
  });

program
  .command('inspect')
  .description('Inspect one tracked agent session: summary, recent events, and current git diff.')
  .argument('<name-or-id>', 'Session id or exact session name')
  .option('--events <count>', 'Number of recent events to show (default 25)')
  .action(async (nameOrId, opts) => {
    const db = openDb(process.env.GITHANGER_DB);
    const eventLimit = Math.max(1, Number(opts.events ?? 25));
    const session =
      (db.prepare('SELECT * FROM sessions WHERE id=?').get(String(nameOrId)) as any) ??
      (db.prepare('SELECT * FROM sessions WHERE name=? ORDER BY startedAt DESC LIMIT 1').get(String(nameOrId)) as any);

    if (!session) {
      throw new Error(`No session found for: ${nameOrId}`);
    }

    console.log(`${session.name} (${session.provider})`);
    console.log(`status:   ${session.status}`);
    console.log(`branch:   ${session.branch}`);
    console.log(`repo:     ${session.repoPath}`);
    console.log(`worktree: ${session.worktreePath}`);
    console.log(`started:  ${new Date(session.startedAt).toLocaleString()}`);
    console.log(`ended:    ${session.endedAt ? new Date(session.endedAt).toLocaleString() : '—'}`);
    console.log('');

    const events = db
      .prepare('SELECT ts, kind, message FROM events WHERE sessionId=? ORDER BY ts DESC LIMIT ?')
      .all(session.id, eventLimit) as Array<{ ts: number; kind: string; message: string | null }>;

    console.log('Recent events');
    console.log('-------------');
    if (!events.length) {
      console.log('No events recorded yet.');
    } else {
      for (const event of events) {
        let message = event.message ?? '';
        try {
          const parsed = JSON.parse(message) as any;
          message = parsed?.text ?? parsed?.detail ?? parsed?.title ?? parsed?.message ?? JSON.stringify(parsed);
        } catch {
          // keep raw message
        }
        const compact = message.replace(/\s+/g, ' ').trim();
        console.log(`[${new Date(event.ts).toLocaleTimeString()}] ${event.kind}: ${compact || '—'}`);
      }
    }

    console.log('');
    console.log('Git diff');
    console.log('--------');
    const diff = await git(['-C', session.worktreePath, 'diff', '--stat', '--patch', '--unified=2']);
    const trimmed = diff.all.trim();
    console.log(trimmed || 'No unstaged diff.');
  });

await program.parseAsync(process.argv);
