# Upgrade Wrapper Plugins (Automated)

Check for available upgrades for dynamic plugin wrappers and automatically
apply all patch and minor upgrades. Major upgrades are skipped and reported.

## Scope

Wrapper packages are under `dynamic-plugins/wrappers/*/`. Each wraps an
upstream dependency from `@backstage/*`, `@backstage-community/*`,
`@roadiehq/*`, or `@red-hat-developer-hub/*`.

## Steps

1. **List all wrapper folders**:

   ```bash
   ls -d dynamic-plugins/wrappers/*/
   ```

2. **For each wrapper folder**, read the `package.json` and extract:

   - The wrapper `name` and `version` fields
   - All `dependencies` that match: `@backstage/*`, `@backstage-community/*`,
     `@roadiehq/*`, or `@red-hat-developer-hub/*`

3. **For each dependency**, fetch the latest version from npm:

   ```bash
   npm view <package-name> dist-tags.latest
   ```

   If `npm view` fails (non-zero exit), skip that package and report it as
   an error. Do NOT treat a failed lookup as up-to-date.

4. **Compare versions and classify**:

   For each dependency, compare the installed version with the latest:
   - **patch**: only the patch version changed (e.g., 0.22.0 -> 0.22.1)
   - **minor**: the minor version changed (e.g., 0.22.0 -> 0.23.0)
   - **major**: the major version changed (e.g., 0.22.0 -> 1.0.0)
   - **up to date**: no change

5. **Apply patch and minor upgrades automatically**:

   For each dependency classified as patch or minor:

   a. Use the `Edit` tool to update the version in the wrapper's `package.json`
      under `dependencies`. **Important**: dependencies use **exact** versions
      (e.g., `"0.22.0"`, NOT `"^0.22.0"`). Keep them exact — do NOT add `^`.

   b. Also update the wrapper's own `version` field to match the primary
      dependency's new version. The **primary dependency** is identified as
      follows:
      - The dependency whose unscoped npm name matches the wrapper folder
        name. E.g., folder `backstage-community-plugin-jenkins` → primary
        dep `@backstage-community/plugin-jenkins`.
      - If no exact match, use the dependency that shares the most name
        segments with the folder name.
      - If still ambiguous (multiple candidates with equal match), do NOT
        change the wrapper version. Log a warning instead.

   Do NOT apply major upgrades. List them in the output for inclusion in the
   PR body.

6. **Run yarn install**:

   After all upgrades are applied, run from the `dynamic-plugins` folder:

   ```bash
   cd dynamic-plugins && yarn install
   ```

   **Error policy**:
   - If `yarn install` fails with resolution conflicts, try `yarn dedupe` first,
     then `yarn install` again.
   - If specific resolutions are needed, add them to `dynamic-plugins/package.json`
     under `resolutions`.
   - If errors persist after two attempts, revert ALL upgraded wrappers to their
     original versions, run `yarn install` to confirm clean state, then report
     all upgrades as failed. Do not attempt partial recovery.

7. **Report results**:

   Output a summary with:
   - Table of applied upgrades (wrapper, dependency, old version, new version)
   - List of skipped major upgrades (wrapper, dependency, current, available)
   - yarn install status

## Notes

- Dependencies use **exact** versions (no `^` or `~`). Always write exact versions.
- Run `yarn install` only once after all upgrades are applied, from the
  `dynamic-plugins` folder (not from individual wrapper folders)
- Only check the `dependencies` field, NOT `devDependencies`. The
  `devDependencies` field contains build tools (`@backstage/cli`,
  `@janus-idp/cli`, `@red-hat-developer-hub/cli`) which are managed
  separately by the upgrade-build-tools command.
- Some wrappers use `@janus-idp/cli` in devDependencies. This is a legacy
  build tool pinned for compatibility — do NOT upgrade it.
