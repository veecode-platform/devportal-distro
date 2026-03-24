# Upgrade Downloaded Plugins (Automated)

Check for available upgrades for downloaded plugins (first-party
`@veecode-platform/*` packages) and apply any version bump.

## Output management

Redirect verbose command output to temporary log files. Check the exit
code to determine success or failure. Inspect log file contents only when
a command exits with non-zero status.

    mkdir -p /tmp/logs

## Scope

Downloaded plugins are listed in `dynamic-plugins/downloads/plugins.json`.
These are first-party packages — all upgrades (patch, minor, and major)
are applied automatically.

## Steps

1. **Read plugins.json**:

   Read `dynamic-plugins/downloads/plugins.json` and extract the list of
   plugins with their current versions.

2. **Check all plugins in a single script**:

   Fetch latest versions for all plugins in one pass:

   ```bash
   for PKG in <list-of-plugins>; do
     ENCODED=$(echo "$PKG" | sed 's/@/%40/; s|/|%2F|')
     LATEST=$(curl -sf "https://registry.npmjs.org/$ENCODED" | jq -r '.["dist-tags"].latest // empty')
     if [ -z "$LATEST" ]; then echo "SKIP $PKG (lookup failed)"; continue; fi
     echo "$PKG $LATEST"
   done
   ```

3. **Compare versions**:

   For each plugin, compare the installed version with the latest.
   If a newer version is available, update the `version` field in
   `plugins.json`.

4. **Update plugins.json**:

   Use the `Edit` tool to update each plugin's version in
   `dynamic-plugins/downloads/plugins.json`.

5. **Download and export**:

   After updating plugins.json, run each command separately and verify
   exit codes:

   ```bash
   cd dynamic-plugins/downloads
   ./download-packages.sh build > /tmp/logs/download-build.log 2>&1
   ```

   Confirm exit code is 0 before proceeding. If `build` fails, inspect
   the log and report the error.

   ```bash
   ./download-packages.sh export-dynamic > /tmp/logs/download-export.log 2>&1
   ```

   Run `build` first — it skips existing files. Then `export-dynamic`
   re-extracts each tarball. Running `clean` beforehand would destroy
   existing tarballs in `dist/` (which is gitignored) with no recovery
   if the new download fails.

6. **Verify downloads**:

   After running the download commands, verify each upgraded plugin has a
   corresponding directory in `dynamic-plugins/downloads/dist/unpacked/`.
   If any are missing, report the failure and revert the `plugins.json`
   changes for those plugins.

7. **Report results**:

   Output a summary with:
   - Table of applied upgrades (plugin name, old version, new version)
   - List of plugins already up to date
   - Download/unpack status
