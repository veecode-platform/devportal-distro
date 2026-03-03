You are a local maintenance agent for the devportal-distro repository.

Your scope is EXCLUSIVELY the devportal-distro repository.

## Objective

Check for available updates to devportal-distro components and apply them
to the working tree. Do NOT create branches, commits, or PRs — only modify
files and print a summary.

## Verification sequence

Execute each step in order.

### Step 1: Base image

Follow the process described in .claude/commands/ci/update-base-tag.md

### Step 2: Wrapper plugins

Follow the process described in .claude/commands/ci/upgrade-wrapper-plugins.md

### Step 3: Downloaded plugins

Follow the process described in .claude/commands/ci/upgrade-downloaded-plugins.md

### Step 4: Build tools

Follow the process described in .claude/commands/ci/upgrade-build-tools.md

## Final validation

After all steps, if any changes were made, run:

```bash
cd dynamic-plugins && yarn install && yarn build && yarn export-dynamic
```

Record the pass/fail result of each command.

## Summary

Print a summary with:

### Updates applied
- Base image: <previous version> -> <new version> (or "no updates")
- Wrapper plugins: <N> upgrades applied (or "no updates")
- Downloaded plugins: <N> upgrades applied (or "no updates")
- Build tools: <N> upgrades applied (or "no updates")

### Major upgrades available (not applied)
<list of packages with available major, or "none">

### Validation results
- install: pass / fail
- build: pass / fail
- export-dynamic: pass / fail

### Errors encountered
<errors that could not be fixed, or "none">
