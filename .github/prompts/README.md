# Claude Code Prompts

Orchestrator prompts for automated maintenance of devportal-distro.

## Prompts

| File | Purpose |
|------|---------|
| `automated-update.md` | Dry-run (local) — applies updates to working tree only, no git operations |
| `automated-update-ci.md` | CI version — creates branch, commits, opens PR via GitHub Actions |

## Running a dry-run locally

```bash
cd /path/to/devportal-distro
.github/prompts/claude-watch.sh .github/prompts/automated-update.md
```
To restrict which tools the agent can use:

```bash
.github/prompts/claude-watch.sh .github/prompts/automated-update.md "Bash,Read,Glob,Grep"
```

### Requirements

- `claude` CLI installed and authenticated
- `jq` installed
- Run from the repo root

### After the run

Review changes with `git diff` and revert if needed with `git checkout .`.
