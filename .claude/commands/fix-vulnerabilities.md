Remediate known vulnerabilities identified by Trivy security scans:

## Prerequisites

- Run `/security-scan` first to generate the split reports
- This skill uses `.trivyscan/main-report.json` (DevPortal distro vulnerabilities only)
- Dynamic plugin vulnerabilities (in `plugins-report.json`) are ignored - they are maintained by upstream projects

## Steps

1. **Parse vulnerability report**:

   Read `.trivyscan/main-report.json` and identify actionable vulnerabilities:

   - npm packages with available fixes (fixable via Yarn resolutions in dynamic-plugins/package.json)
   - Skip system packages (RHEL/UBI) - not actionable in this repo, requires upstream devportal-base or ubi9 update

2. **For npm vulnerabilities in wrapper plugins**:

   Add resolutions to `dynamic-plugins/package.json` under the `resolutions` block:

   ```json
   "resolutions": {
     "vulnerable-package": "^fixed.version"
   }
   ```

   **Important constraints:**

   - **NEVER add resolutions for `@backstage/*` packages** - these must only be updated via the Backstage upgrade process in devportal-base
   - Only add resolutions for patch/minor updates
   - Skip major version bumps that may break dependencies (document for later)
   - Test that resolutions don't break the build

3. **For vulnerabilities in downloaded plugins**:

   These are pre-built plugins downloaded from npm. Vulnerabilities here require:

   - Waiting for the upstream plugin maintainer to release a fix
   - Updating the plugin version in `plugins.json`
   - Note: Pin specific versions in `plugins.json` to get fixes

4. **For base image vulnerabilities**:

   If vulnerabilities are in OS packages or base dependencies, they need to be fixed in the upstream `veecode/devportal-base` image. Document these and report to the devportal-base repository.

5. **Verify changes**:

   ```bash
   cd dynamic-plugins && yarn install && yarn build
   ```

6. **Report results**:

   Provide a summary of:

   - Vulnerabilities fixed (package, old version, new version)
   - Vulnerabilities that need upstream fixes (base image, downloaded plugins)
   - Vulnerabilities skipped (and why: major bump, system package, no fix available)
   - Build status

## Vulnerability Categories

| Type                 | Action                                   | Notes                                  |
| -------------------- | ---------------------------------------- | -------------------------------------- |
| npm (wrapper plugin) | Add to dynamic-plugins/resolutions       | Safe to fix                            |
| npm (major bump)     | Document only                            | Requires upgrade coordination          |
| Downloaded plugins   | Update version in plugins.json           | Depends on upstream maintainer         |
| Base image (Node.js) | Report to devportal-base                 | Requires upstream release              |
| System (RHEL)        | Skip                                     | Requires upstream Red Hat/base fixes   |
| No fix available     | Skip                                     | Monitor for future fixes               |

## Example Resolutions

In `dynamic-plugins/package.json`:

```json
"resolutions": {
  "qs": "^6.14.1",
  "undici": "7.16.0"
}
```

## Notes

- Always run tests after applying fixes
- Some resolutions may break builds due to API changes - revert if needed
- Keep track of skipped vulnerabilities for future upgrades
- Most vulnerabilities in this distro image come from the upstream `veecode/devportal-base` - coordinate with that repo for fixes
