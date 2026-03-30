# GitHanger

GitHanger is a local git + agent workflow tool for managing AI coding sessions, worktrees, branches, diffs, and repo state from both a CLI and a local dashboard.

Once you start using multiple coding agents seriously, the workflow gets chaotic fast:
- parallel sessions
- temporary worktrees
- branches per task
- local diffs everywhere
- unclear commit/push state
- no easy way to see what each agent actually changed

GitHanger makes that visible.

## What GitHanger gives you

- **CLI + local dashboard** for the same workspace
- **Tracked agent sessions** with repo, branch, worktree, provider, and event history
- **Managed worktrees** for agent runs
- **Branch explorer** with search + creation from an existing source branch
- **Worktree git actions** from the dashboard:
  - stage
  - unstage
  - discard
  - commit
  - pull
  - push
- **Session inspection** in browser and terminal
- **Diff visibility** so you can see what an agent changed before deciding what to keep

## Current features

### Dashboard

- repo list / registered repos
- local branches list
- **branch search**
- branches sorted by **latest created date**
- branch creation from a selected source branch
- worktree table with dirty counts, jump, open, and managed-worktree remove
- session list and session detail views
- session timeline / event feed
- worktree diff and commit history views

### Worktree actions

- stage all or per-file stage
- per-file unstage
- per-file discard
- commit with message from dashboard
- pull with upstream checks
- push with upstream detection / first-push setup
- staged + unstaged diff panes

### CLI

- `githanger init`
- `githanger run`
- `githanger start`
- `githanger serve`
- `githanger status`
- `githanger inspect <session-name-or-id>`

### Runtime / storage

- tracked sessions stored locally in SQLite
- default database: `~/.githanger/githanger.sqlite`
- runtime logs from `githanger start` stored in `~/.githanger/`

## Install

Global install:

```bash
npm install -g githanger
```

One-off usage:

```bash
npx githanger --help
```

## Quick start

### 1. Register a repo

```bash
cd /path/to/your/repo
githanger init
```

### 2. Start the dashboard

```bash
githanger start
```

Then open:

```text
http://127.0.0.1:5173
```

### 3. Start a tracked agent session

```bash
cd /path/to/your/repo
githanger run
```

### 4. Inspect sessions in terminal

```bash
githanger status
githanger inspect <session-name-or-id>
```

## Installed-package flow

GitHanger is now packaged so that after:

```bash
npm install -g githanger
```

this should work directly:

```bash
githanger start
```

without needing to clone the repo just to boot the dashboard.

## Source-checkout workflow

If you’re developing on GitHanger itself:

```bash
git clone https://github.com/Skriller18/GitHanger.git
cd GitHanger
npm install
npm run build
githanger start
```

## Terminal commands

### `githanger status`

Shows tracked agent sessions, including:
- name
- provider
- branch
- repo/worktree path
- pid state
- last activity

### `githanger inspect <session-name-or-id>`

Shows:
- session summary
- recent events
- current git diff for that session worktree

This is the terminal-side visibility layer for checking what an agent is doing without opening the browser.

## Dashboard notes

### Branches

The branches panel supports:
- search by branch name
- sort by latest created date
- branch creation from a selected source branch

### Sessions

The session detail page is meant to show:
- session metadata
- activity timeline
- approval state
- quick jump into the worktree diff view

### Worktree page

From a worktree page you can:
- stage / unstage
- discard changes
- commit
- pull
- push
- inspect staged and unstaged diffs
- review recent commits

## Monorepo structure

- `packages/cli` — published `githanger` CLI
- `packages/server` — local Fastify API
- `packages/web` — React dashboard
- `packages/shared` — shared utilities/types

## Development commands

```bash
npm run build
npm run typecheck
npm run lint
npm run start
```

## Release / npm publish notes

Build a local tarball:

```bash
npm run pack:cli
```

Dry-run package contents:

```bash
npm run pack:cli:dry
```

Publish the CLI package:

```bash
npm run publish:cli
```

Version bump example:

```bash
npm version patch
npm run pack:cli
npm run publish:cli
```

## Current published version

Latest published package:

```text
githanger@0.1.2
```
