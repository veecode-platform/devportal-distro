# Upgrade Build Tools (Automated)

Check for available upgrades for build tool packages in
`dynamic-plugins/package.json` and automatically apply patch and minor
upgrades. Major upgrades are skipped and reported.

## Scope

Build tools are in `devDependencies` of `dynamic-plugins/package.json`:
- `@backstage/cli`
- `@red-hat-developer-hub/cli`

## Steps

1. **Read dynamic-plugins/package.json**:

   Read `dynamic-plugins/package.json` and extract the current versions
   of `@backstage/cli` and `@red-hat-developer-hub/cli` from `devDependencies`.
   Strip the `^` prefix for comparison.

2. **For each package**, fetch the latest version from npm:

   ```bash
   npm view <package-name> dist-tags.latest
   ```

   If `npm view` fails (non-zero exit), skip that package and report it as
   an error. Do NOT treat a failed lookup as up-to-date.

3. **Compare versions and classify**:

   For each package, compare the installed version with the latest:
   - **patch**: only the patch version changed (e.g., 0.30.0 -> 0.30.1)
   - **minor**: the minor version changed (e.g., 0.30.0 -> 0.31.0)
   - **major**: the major version changed (e.g., 0.30.0 -> 1.0.0)
   - **up to date**: no change

4. **Apply upgrades automatically** (with 0.x semver rule):

   For packages with major version 0 (e.g., `0.x.y`), treat minor bumps as
   major (skip and report). Only apply patch upgrades automatically for 0.x
   packages.

   For packages with major version >= 1, apply patch and minor upgrades
   automatically. Skip major upgrades.

   For each applicable upgrade, use the `Edit` tool to update the version in
   `dynamic-plugins/package.json` under `devDependencies`. Preserve the `^`
   prefix.

   Do NOT apply major upgrades (or 0.x minor bumps). List them in the output
   for inclusion in the PR body.

5. **Run yarn install**:

   After all upgrades are applied, run from the `dynamic-plugins` folder:

   ```bash
   cd dynamic-plugins && yarn install
   ```

6. **Report results**:

   Output a summary with:
   - Table of applied upgrades (package, old version, new version)
   - List of skipped major upgrades (package, current, available)
   - yarn install status

## Notes

- Always preserve the `^` prefix when updating versions
- Run `yarn install` only once after all upgrades are applied
