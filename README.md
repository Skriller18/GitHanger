# GitHanger

GitHanger is a local git + agent workflow tool built for modern developer workflows with AI coding agents.

As soon as you start working with agents seriously, the workflow gets messy fast: multiple sessions running in parallel, separate branches for different tasks, temporary worktrees, diffs piling up, and constant context switching between what should be committed, discarded, or pushed.

GitHanger gives you a CLI plus a local dashboard for tracking agent sessions, worktrees, branch state, and diff/commit activity so agent-assisted development stays visible and manageable.

## Current features

- Dashboard repo view:
  - registered repos
  - local branches list
  - branch creation from a selected source branch
  - worktree table with dirty counts, open, jump, and managed-worktree remove
- Session UI:
  - global sessions list
  - session detail page with live SSE activity stream
  - chat event feed (`chat_user` / `chat_agent`)
  - terminate and delete session controls
- Worktree detail UI:
  - staged / unstaged / untracked status sections
  - per-file stage / unstage / discard actions
  - commit input
  - pull / push actions
  - uncommitted + staged diff panes
  - recent commits feed with pagination
- Jump behavior:
  - dedicated `me` worktree per repo
  - auto-stash on branch leave when dirty
  - auto-apply previously stashed branch state when jumping back
- Git action behavior:
  - `stage`: file or all changes (`git add`)
  - `commit`: normal commit with provided message
  - `pull`: `--ff-only`, requires configured upstream
  - `push`: uses existing upstream, otherwise first push sets upstream (`origin` preferred)
- Session/worktree management:
  - tracked session records in local SQLite (`~/.githanger/githanger.sqlite`)
  - managed worktree removal guarded to `.worktrees/githanger/*`

## Install (npm CLI)

Global install:

```bash
npm install -g githanger
```

One-off usage with `npx`:

```bash
npx githanger --help
```

Core CLI usage:

```bash
# register repo
cd /path/to/your/repo
githanger init

# create and run a tracked agent session in its own worktree
githanger run

# see all tracked agents in the terminal
githanger status

# inspect one agent, recent events, and current diff
githanger inspect <session-name-or-id>
```

## Dashboard usage

After global install, GitHanger can start the backend + dashboard directly:

```bash
npm install -g githanger
githanger start
```

Open `http://127.0.0.1:5173`.

Source-checkout workflow still works too:

```bash
git clone https://github.com/Skriller18/GitHanger.git
cd GitHanger
npm install
npm run build
githanger start
```

## Monorepo development

Workspace layout:

- `packages/cli` - `githanger` CLI package
- `packages/server` - local Fastify API
- `packages/web` - React dashboard
- `packages/shared` - shared utilities/types

Common commands:

```bash
npm run build
npm run typecheck
npm run lint
npm run start
```

## npm publish notes (CLI)

Build and create a local tarball:

```bash
npm run pack:cli
```

Dry-run package contents:

```bash
npm run pack:cli:dry
```

Publish:

```bash
npm run publish:cli
```

Versioning:

```bash
npm version patch   # or minor / major
npm run pack:cli
npm run publish:cli
```

This project is currently at `0.1.1`; use patch bumps for bug fixes, minor for backwards-compatible features, and major for breaking CLI changes.
