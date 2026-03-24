Scan a Docker image for security vulnerabilities using Trivy.

## Arguments

- `$ARGUMENTS` - Docker image to scan (e.g., `veecode/devportal:1.0.0`).
  Defaults to `veecode/devportal:latest` if omitted.

## Steps

1. **Determine the image to scan**:

   Use `$ARGUMENTS` if provided, otherwise default to `veecode/devportal:latest`.

2. **Create output directory and run scan**:

   ```bash
   mkdir -p .trivyscan
   trivy image --ignore-policy .trivy/ignore-kernel.rego --quiet --format json <image> > .trivyscan/report.json
   ```

3. **Split the report** into main DevPortal and dynamic plugins:

   ```bash
   .trivy/split-report.sh .trivyscan/report.json
   ```

   This creates:
   - `.trivyscan/main-report.json` - DevPortal distro vulnerabilities (actionable)
   - `.trivyscan/plugins-report.json` - Dynamic plugin vulnerabilities (upstream-maintained)

4. **Generate markdown reports**:

   ```bash
   .trivy/generate-report.sh .trivyscan/main-report.json "DevPortal Distro" > .trivyscan/main-report.md
   .trivy/generate-report.sh .trivyscan/plugins-report.json "Dynamic Plugins" > .trivyscan/plugins-report.md
   ```

5. **Report results** with separate summary tables:

   ### DevPortal Distro (Actionable)

   | Severity | Count |
   | -------- | ----- |
   | Critical | X     |
   | High     | X     |
   | Medium   | X     |
   | Low      | X     |

   - List packages with high-severity vulnerabilities
   - Note which vulnerabilities have fixes available

   ### Dynamic Plugins (Upstream)

   | Severity | Count |
   | -------- | ----- |
   | Critical | X     |
   | High     | X     |
   | Medium   | X     |
   | Low      | X     |

   - List packages with high-severity vulnerabilities
   - These are maintained by upstream plugin projects

## Output Files

| File | Content |
|------|---------|
| `.trivyscan/report.json` | Full JSON report (all vulnerabilities) |
| `.trivyscan/main-report.json` | DevPortal distro vulnerabilities only |
| `.trivyscan/main-report.md` | Human-readable DevPortal report |
| `.trivyscan/plugins-report.json` | Dynamic plugin vulnerabilities only |
| `.trivyscan/plugins-report.md` | Human-readable plugins report |

## Prerequisites

- Trivy must be installed (`brew install trivy` or see https://trivy.dev)
- The `.trivyscan/` folder is gitignored
- Kernel packages are excluded via `.trivy/ignore-kernel.rego` (requires host-level fixes)
- Dynamic plugins are split into a separate report because they are upstream-maintained
