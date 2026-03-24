# Upgrade Wrapper Plugins (Automated)

Check for available upgrades for dynamic plugin wrappers and automatically
apply all patch and minor upgrades. Major upgrades are skipped and reported.

## Output management

Redirect verbose command output to temporary log files. Check the exit
code to determine success or failure. Inspect log file contents only when
a command exits with non-zero status.

    mkdir -p /tmp/logs
    cd dynamic-plugins && yarn install > /tmp/logs/wrapper-install.log 2>&1

## Scope

Wrapper packages are under `dynamic-plugins/wrappers/*/`. Each wraps an
upstream dependency from `@backstage/*`, `@backstage-community/*`,
`@roadiehq/*`, or `@red-hat-developer-hub/*`.

Only check the `dependencies` field. The `devDependencies` field contains
build tools (`@backstage/cli`, `@red-hat-developer-hub/cli`) managed by
upgrade-build-tools, and `@janus-idp/cli` which is pinned for compatibility
and excluded from automated upgrades.

## Steps

1. **List all wrapper folders**:

   ```bash
   ls -d dynamic-plugins/wrappers/*/
   ```

2. **For each wrapper folder**, read the `package.json` and extract:

   - The wrapper `name` and `version` fields
   - All `dependencies` that match: `@backstage/*`, `@backstage-community/*`,
     `@roadiehq/*`, or `@red-hat-developer-hub/*`

3. **Check all dependencies in a single script**:

   Fetch latest versions for all extracted dependencies in one pass:

   ```bash
   for PKG in <list-of-dependencies>; do
     ENCODED=$(echo "$PKG" | sed 's/@/%40/; s|/|%2F|')
     LATEST=$(curl -sf "https://registry.npmjs.org/$ENCODED" | jq -r '.["dist-tags"].latest // empty')
     if [ -z "$LATEST" ]; then echo "SKIP $PKG (lookup failed)"; continue; fi
     echo "$PKG $LATEST"
   done
   ```

4. **Compare versions and classify**:

   For each dependency, compare the installed version with the latest:
   - **patch**: only the patch version changed (e.g., 0.22.0 → 0.22.1)
   - **minor**: the minor version changed (e.g., 0.22.0 → 0.23.0)
   - **major**: the major version changed (e.g., 0.22.0 → 1.0.0) — skip, list for PR body
   - **up to date**: no change

5. **Apply patch and minor upgrades**:

   For each dependency classified as patch or minor:

   a. Use the `Edit` tool to update the version in the wrapper's `package.json`
      under `dependencies`. Dependencies use **exact** versions (e.g., `"0.22.0"`).
      Keep them exact — write exact versions only.

   b. Also update the wrapper's own `version` field to match the primary
      dependency's new version. The **primary dependency** is identified as:
      - The dependency whose unscoped npm name matches the wrapper folder
        name. E.g., folder `backstage-community-plugin-jenkins` → primary
        dep `@backstage-community/plugin-jenkins`.
      - If no exact match, use the dependency that shares the most name
        segments with the folder name.
      - If still ambiguous (multiple candidates with equal match), leave
        the wrapper version unchanged and log a warning.

6. **Run yarn install and verify**:

   After all upgrades are applied, run from the `dynamic-plugins` folder:

   ```bash
   cd dynamic-plugins && yarn install > /tmp/logs/wrapper-final-install.log 2>&1
   ```

   Confirm exit code is 0 before reporting success.

   **Error policy**:
   - If `yarn install` fails with resolution conflicts, try `yarn dedupe` first,
     then `yarn install` again.
   - If specific resolutions are needed, add them to `dynamic-plugins/package.json`
     under `resolutions`.
   - If errors persist after two attempts, revert ALL upgraded wrappers to their
     original versions, run `yarn install` to confirm clean state, then report
     all upgrades as failed.

7. **Report results**:

   Output a summary with:
   - Table of applied upgrades (wrapper, dependency, old version, new version)
   - List of skipped major upgrades (wrapper, dependency, current, available)
   - yarn install: pass / fail
