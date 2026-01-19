#!/usr/bin/env bash
# Split Trivy JSON report into main (DevPortal) and plugins (dynamic-plugins) reports
# Usage: .trivy/split-report.sh .trivyscan/report.json
#
# Output:
#   .trivyscan/main-report.json   - Vulnerabilities NOT in dynamic-plugins-root
#   .trivyscan/plugins-report.json - Vulnerabilities in dynamic-plugins-root

set -euo pipefail

JSON_FILE="${1:-.trivyscan/report.json}"
OUTPUT_DIR=$(dirname "$JSON_FILE")

if [[ ! -f "$JSON_FILE" ]]; then
  echo "Error: JSON file not found: $JSON_FILE" >&2
  exit 1
fi

# Create main report (vulnerabilities NOT in dynamic-plugins-root)
# This includes: OS packages, Python packages, Go binaries, and app packages outside dynamic-plugins-root
jq '
  . as $root |
  .Results = [
    .Results[] |
    if .Vulnerabilities == null then
      .
    else
      .Vulnerabilities = [
        .Vulnerabilities[] |
        select(
          (.PkgPath == null) or
          (.PkgPath | contains("dynamic-plugins-root") | not)
        )
      ] |
      select(.Vulnerabilities | length > 0)
    end
  ]
' "$JSON_FILE" > "$OUTPUT_DIR/main-report.json"

# Create plugins report (vulnerabilities in dynamic-plugins-root)
jq '
  . as $root |
  .Results = [
    .Results[] |
    if .Vulnerabilities == null then
      empty
    else
      .Vulnerabilities = [
        .Vulnerabilities[] |
        select(
          .PkgPath != null and
          (.PkgPath | contains("dynamic-plugins-root"))
        )
      ] |
      select(.Vulnerabilities | length > 0)
    end
  ]
' "$JSON_FILE" > "$OUTPUT_DIR/plugins-report.json"

# Count vulnerabilities in each report
MAIN_COUNT=$(jq '[.Results[].Vulnerabilities // [] | .[]] | length' "$OUTPUT_DIR/main-report.json")
PLUGINS_COUNT=$(jq '[.Results[].Vulnerabilities // [] | .[]] | length' "$OUTPUT_DIR/plugins-report.json")

echo "Split complete:"
echo "  Main report:    $OUTPUT_DIR/main-report.json ($MAIN_COUNT vulnerabilities)"
echo "  Plugins report: $OUTPUT_DIR/plugins-report.json ($PLUGINS_COUNT vulnerabilities)"
