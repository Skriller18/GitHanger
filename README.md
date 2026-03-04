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

## Dev
```bash
npm install
npm run build

# server
npm run -w @githanger/server dev

# web
npm run -w @githanger/web dev

# run an agent session (interactive)
node packages/cli/dist/index.js run
```

## Notes
This is early scaffolding. Next steps:
- repo registration + worktree discovery
- diff/commit endpoints
- dashboard pages wired to API
- GitHub read-only integration (PR + checks)
