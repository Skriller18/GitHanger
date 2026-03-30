# githanger

GitHanger CLI for managing local git worktrees, tracked AI agent sessions, and the bundled local dashboard.

## Install

```bash
npm install -g githanger
```

Or use it one-off with:

```bash
npx githanger --help
```

## Main commands

### Register a repo

```bash
cd /path/to/your/repo
githanger init
```

### Start the dashboard

```bash
githanger start
```

This starts the local API server and dashboard.

Default dashboard URL:

```text
http://127.0.0.1:5173
```

### Start a tracked agent session

```bash
cd /path/to/your/repo
githanger run
```

### Show all tracked sessions

```bash
githanger status
```

### Inspect one session

```bash
githanger inspect <session-name-or-id>
```

This shows:
- session summary
- recent recorded events
- current git diff for the session worktree

### Advanced / source-checkout usage

```bash
githanger serve
```

Runs only the local API server. This is mainly useful in source-checkout or advanced local development flows.

## Installed-package behavior

`githanger start` is intended to work after a normal global install, without cloning the repo:

```bash
npm install -g githanger
githanger start
```

The published package bundles:
- CLI
- server build
- dashboard static assets

## Typical flow

```bash
# install once
npm install -g githanger

# register a repo
cd ~/projects/my-repo
githanger init

# start dashboard
githanger start

# run tracked agent session
cd ~/projects/my-repo
githanger run

# inspect sessions in terminal
githanger status
githanger inspect my-session
```

## Local storage

Session metadata is stored locally in:

```text
~/.githanger/githanger.sqlite
```

Runtime logs from `githanger start` are written under:

```text
~/.githanger/
```

## Notes

- `githanger start` works for both installed-package and source-checkout flows.
- In a source checkout, run `npm run build` before packaging/publishing.
- Session metadata stays local to your machine.
- Latest published package: `githanger@0.1.2`
