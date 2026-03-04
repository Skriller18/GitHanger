# GitHanger

Local agent+git dashboard to track **which agent is working on which branch/worktree**, and to browse **diffs + commits**.

## What it is (MVP)
- Agents (Claude Code / Codex) are launched via `githanger run`.
- Each agent gets its own git **worktree**, so you can freely jump branches in your own checkout without disrupting the agent.
- A local server exposes session state (SQLite-backed) and (next) git diff/commit endpoints.
- A local web UI (next) shows repos/branches/agents and branch detail pages.

## Repo layout
- `packages/cli` — `githanger` CLI
- `packages/server` — local API server
- `packages/web` — dashboard UI (Vite+React)
- `packages/shared` — shared types + defaults

## Quickstart (run locally)

### One command setup (install + build + link CLI)
From the repo root:
```bash
cd GitHanger
npm run setup
```

This will:
- `npm install`
- build TypeScript packages
- `npm link` the `githanger` command

Verify:
```bash
githanger --help
```

### One command start (API + web UI)
From the repo root:
```bash
githanger start
```

(Equivalent: `npm run start`)

Open the Vite URL (usually `http://localhost:5173`).

### Register a repo
```bash
cd /path/to/your/repo
githanger init
```

### Start an agent session (Claude Code or Codex)
```bash
cd /path/to/your/repo
githanger run
```
Interactive prompts:
- provider: `claude` or `codex`
- session name
- branch name
- command to run (for you: `claude` or `codex`) + optional args

Sessions are tracked in `~/.githanger/githanger.sqlite`.

### Jump between branches (safe)
Use the dashboard "Jump" buttons. GitHanger will:
- switch your dedicated `me` worktree
- auto-stash changes when you leave a branch
- auto-apply the stash when you return
- **never** disturb agent worktrees

## Dev notes
- `packages/cli` — CLI
- `packages/server` — API
- `packages/web` — UI
- `packages/shared` — types

## Roadmap (near-term)
- Better UI for jump results (conflicts, applied stash info)
- Branch-based navigation (not only worktrees) ✅ (local branches + compare view)
- GitHub read-only integration (PR link + checks)
