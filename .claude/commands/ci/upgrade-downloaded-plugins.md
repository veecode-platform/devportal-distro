# Upgrade Downloaded Plugins (Automated)

Check for available upgrades for downloaded plugins (first-party
`@veecode-platform/*` packages) and apply any version bump.

## Scope

Downloaded plugins are listed in `dynamic-plugins/downloads/plugins.json`.
These are first-party packages — all upgrades (patch, minor, and major)
are applied automatically without restriction.

## Steps

1. **Read plugins.json**:

   Read `dynamic-plugins/downloads/plugins.json` and extract the list of
   plugins with their current versions.

2. **For each plugin**, fetch the latest version from npm:

   ```bash
   npm view <package-name> dist-tags.latest
   ```

   If `npm view` fails (non-zero exit), skip that package and report it as
   an error. Do NOT treat a failed lookup as up-to-date.

3. **Compare versions**:

   For each plugin, compare the installed version with the latest.
   If a newer version is available, update the `version` field in
   `plugins.json`.

4. **Update plugins.json**:

   Use the `Edit` tool to update each plugin's version in
   `dynamic-plugins/downloads/plugins.json`.

5. **Download and export**:

   After updating plugins.json, run:

   ```bash
   cd dynamic-plugins/downloads && ./download-packages.sh build && ./download-packages.sh export-dynamic
   ```

   Do NOT run `clean` before `build` — it destroys existing tarballs in
   `dist/files/` and `dist/unpacked/`. If `build` then fails, the working
   artifacts cannot be recovered (the `dist/` directory is gitignored).
   `build` already skips existing files, and `export-dynamic` re-extracts
   each tarball.

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
