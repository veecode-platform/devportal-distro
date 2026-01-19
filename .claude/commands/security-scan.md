Scan a Docker image for security vulnerabilities using Trivy:

## Arguments

- `$ARGUMENTS` - Docker image to scan (e.g., `veecode/devportal:1.0.0`). If not provided, defaults to `veecode/devportal:latest`.

## Steps

1. **Determine the image to scan**:

   - Use `$ARGUMENTS` if provided
   - Otherwise default to `veecode/devportal:latest`

2. **Create output directory and run scan**:

   ```bash
   mkdir -p .trivyscan
   ```

   Run the JSON scan and save to `.trivyscan/report.json`:

   ```bash
   trivy image --ignore-policy .trivy/ignore-kernel.rego --quiet --format json <image> > .trivyscan/report.json
   ```

3. **Split the report** into main DevPortal and dynamic plugins:

   ```bash
   .trivy/split-report.sh .trivyscan/report.json
   ```

   This creates:

   - `.trivyscan/main-report.json` - DevPortal base vulnerabilities (actionable by this project)
   - `.trivyscan/plugins-report.json` - Dynamic plugin vulnerabilities (maintained by upstream projects)

4. **Generate markdown reports**:

   ```bash
   .trivy/generate-report.sh .trivyscan/main-report.json "DevPortal Base" > .trivyscan/main-report.md
   .trivy/generate-report.sh .trivyscan/plugins-report.json "Dynamic Plugins" > .trivyscan/plugins-report.md
   ```

5. **Report results** with separate summary tables for each:

   ### DevPortal Base (Actionable)

   | Severity | Count |
   | -------- | ----- |
   | Critical | X     |
   | High     | X     |
   | Medium   | X     |
   | Low      | X     |

   - List packages with high-severity vulnerabilities
   - Note which vulnerabilities have fixes available
   - These are actionable within this project

   ### Dynamic Plugins (Upstream)

   | Severity | Count |
   | -------- | ----- |
   | Critical | X     |
   | High     | X     |
   | Medium   | X     |
   | Low      | X     |

   - List packages with high-severity vulnerabilities
   - Note: These are maintained by upstream plugin projects and not directly actionable here

## Output Files

- `.trivyscan/report.json` - Full JSON report (all vulnerabilities)
- `.trivyscan/main-report.json` - DevPortal base vulnerabilities only
- `.trivyscan/main-report.md` - Human-readable DevPortal report
- `.trivyscan/plugins-report.json` - Dynamic plugin vulnerabilities only
- `.trivyscan/plugins-report.md` - Human-readable plugins report

## Notes

- Trivy must be installed (`brew install trivy` or see <https://trivy.dev>)
- The scan analyzes OS packages (RPM, APT) and application dependencies (npm, Python, Go, etc.)
- Kernel packages are ignored via `.trivy/ignore-kernel.rego` Rego policy - they require host-level fixes and are not actionable within containers
- Dynamic plugins (in `dynamic-plugins-root/`) are split into a separate report because they are maintained by upstream projects
- Use `--ignore-unfixed` flag to show only vulnerabilities with available fixes
- The `.trivyscan/` folder should be added to `.gitignore`
