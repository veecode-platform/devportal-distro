Remediate known vulnerabilities identified by Trivy security scans.

## Prerequisites

- Run `/security-scan` first to generate the split reports
- This command uses `.trivyscan/main-report.json` (DevPortal distro vulnerabilities only)
- Dynamic plugin vulnerabilities (in `plugins-report.json`) are upstream-maintained

## Steps

1. **Parse vulnerability report**:

   Read `.trivyscan/main-report.json` and extract actionable vulnerabilities
   using `jq`:

   ```bash
   jq '[.Results[]? | .Vulnerabilities[]? | select(.FixedVersion != null and .FixedVersion != "") | {id: .VulnerabilityID, pkg: .PkgName, severity: .Severity, installed: .InstalledVersion, fixed: .FixedVersion}]' .trivyscan/main-report.json
   ```

   Use this filtered output as source of truth. Focus on npm packages
   with available fixes. System packages (RHEL/UBI) require upstream
   devportal-base or UBI updates — document them but skip.

2. **For npm vulnerabilities in wrapper plugins**:

   Add resolutions to `dynamic-plugins/package.json` under the `resolutions` block:

   ```json
   "resolutions": {
     "vulnerable-package": "^fixed.version"
   }
   ```

   **Constraints**:
   - Backstage core packages (`@backstage/*`) are updated only via the
     Backstage upgrade process in devportal-base — skip them here
   - Only add resolutions for patch/minor updates
   - Skip major version bumps (document for later)

3. **For vulnerabilities in downloaded plugins**:

   These are pre-built plugins downloaded from npm. They require:
   - Waiting for the upstream plugin maintainer to release a fix
   - Updating the plugin version in `plugins.json`

4. **Verify changes**:

   After applying resolutions, run the full validation sequence:

   ```bash
   mkdir -p /tmp/logs
   cd dynamic-plugins
   yarn dedupe > /tmp/logs/dedupe.log 2>&1
   yarn install > /tmp/logs/install.log 2>&1
   yarn build > /tmp/logs/build.log 2>&1
   ```

   If any command fails, read its log to identify the error. If a specific
   resolution caused the failure, revert that resolution and move the
   associated CVE to "Vulnerabilities not fixed" with reason "fix causes
   build regression".

5. **Report results**:

   Provide a summary of:
   - Vulnerabilities fixed (CVE, package, old version, new version)
   - Vulnerabilities that need upstream fixes (base image, downloaded plugins)
   - Vulnerabilities skipped (and why: major bump, system package, Backstage core)
   - Build status: pass / fail

## Vulnerability Categories

| Type                 | Action                             | Notes                                |
| -------------------- | ---------------------------------- | ------------------------------------ |
| npm (wrapper plugin) | Add to dynamic-plugins/resolutions | Safe to fix                          |
| npm (major bump)     | Document only                      | Requires upgrade coordination        |
| Downloaded plugins   | Update version in plugins.json     | Depends on upstream maintainer       |
| Backstage core       | Skip                               | Updated via devportal-base upgrade   |
| Base image (Node.js) | Report to devportal-base           | Requires upstream release            |
| System (RHEL)        | Skip                               | Requires upstream Red Hat/base fixes |
| No fix available     | Skip                               | Monitor for future fixes             |
