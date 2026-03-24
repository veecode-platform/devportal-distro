# Upgrade Build Tools (Automated)

Check for available upgrades for build tool packages in
`dynamic-plugins/package.json` and automatically apply patch upgrades.

## Output management

Redirect verbose command output to temporary log files. Check the exit
code to determine success or failure. Inspect log file contents only when
a command exits with non-zero status.

    mkdir -p /tmp/logs

## Scope

Build tools are in `devDependencies` of `dynamic-plugins/package.json`:
- `@backstage/cli`
- `@red-hat-developer-hub/cli`

## Steps

1. **Read dynamic-plugins/package.json**:

   Extract the current versions of `@backstage/cli` and
   `@red-hat-developer-hub/cli` from `devDependencies`.
   Strip the `^` prefix for comparison.

2. **Check all packages in a single script**:

   Fetch latest versions in one pass:

   ```bash
   for PKG in @backstage/cli @red-hat-developer-hub/cli; do
     ENCODED=$(echo "$PKG" | sed 's/@/%40/; s|/|%2F|')
     LATEST=$(curl -sf "https://registry.npmjs.org/$ENCODED" | jq -r '.["dist-tags"].latest // empty')
     if [ -z "$LATEST" ]; then echo "SKIP $PKG (lookup failed)"; continue; fi
     echo "$PKG $LATEST"
   done
   ```

3. **Compare versions and classify**:

   For each package, compare the installed version with the latest:
   - **patch**: only the patch version changed (e.g., 0.30.0 → 0.30.1)
   - **minor**: the minor version changed (e.g., 0.30.0 → 0.31.0)
   - **major**: the major version changed (e.g., 0.30.0 → 1.0.0)
   - **up to date**: no change

4. **Apply upgrades** (with 0.x semver rule):

   For packages with major version 0 (e.g., `0.x.y`), treat minor bumps as
   major — skip and report. Only apply patch upgrades for 0.x packages.

   For packages with major version >= 1, apply patch and minor upgrades.
   Skip major upgrades.

   Use the `Edit` tool to update the version in `dynamic-plugins/package.json`
   under `devDependencies`. Preserve the `^` prefix.

5. **Run yarn install and verify**:

   After all upgrades are applied, run from the `dynamic-plugins` folder:

   ```bash
   cd dynamic-plugins && yarn install > /tmp/logs/build-tools-install.log 2>&1
   ```

   Confirm exit code is 0 before reporting success.

   **Error policy**:
   - If `yarn install` fails with resolution conflicts, try `yarn dedupe` first,
     then `yarn install` again.
   - If errors persist, revert the build tool version changes, run `yarn install`
     to confirm clean state, then report all upgrades as failed.

6. **Report results**:

   Output a summary with:
   - Table of applied upgrades (package, old version, new version)
   - List of skipped upgrades (package, current, available, reason)
   - yarn install: pass / fail
