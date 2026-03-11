# githanger

GitHanger CLI for managing local git worktrees and tracked AI agent sessions.

## Install

```bash
npm install -g githanger
```

Or run one-off commands with `npx`:

```bash
npx githanger --help
```

## Commands

- `githanger init` register a repository in `~/.githanger/githanger.sqlite`
- `githanger run` start an agent session in a dedicated worktree
- `githanger serve` run the local API server (from a GitHanger source checkout)
- `githanger start` run API + web dashboard (from a GitHanger source checkout)

## Notes

- `serve` and `start` are source-checkout workflows. Run them from the GitHanger monorepo root after building.
- Session metadata is stored locally and never sent to a remote service by this package.
