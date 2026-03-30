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
- `githanger serve` run the local API server (primarily for source checkouts / advanced usage)
- `githanger start` run API + web dashboard from either a source checkout or an installed npm package
- `githanger status` show all tracked agent sessions in the terminal
- `githanger inspect <session-name-or-id>` show one session, recent events, and current diff

## Notes

- `githanger start` is intended to work after `npm install -g githanger`, without cloning the repo.
- In a source checkout, run `npm run build` once before packaging/publishing so bundled server + dashboard assets are available.
- Session metadata is stored locally and never sent to a remote service by this package.
