#!/usr/bin/env bash
# Generate a human-readable markdown report from Trivy JSON output
# Usage: .trivy/generate-report.sh <json_file> [report_title]
# Example: .trivy/generate-report.sh .trivyscan/main-report.json "DevPortal Base"

set -euo pipefail

JSON_FILE="${1:-.trivyscan/report.json}"
REPORT_TITLE="${2:-}"

if [[ ! -f "$JSON_FILE" ]]; then
  echo "Error: JSON file not found: $JSON_FILE" >&2
  exit 1
fi

# Extract metadata
ARTIFACT_NAME=$(jq -r '.ArtifactName // "Unknown"' "$JSON_FILE")
CREATED_AT=$(jq -r '.CreatedAt // "Unknown"' "$JSON_FILE" | cut -d'T' -f1)

# Build title
if [[ -n "$REPORT_TITLE" ]]; then
  FULL_TITLE="# Security Scan Report: $REPORT_TITLE"
else
  FULL_TITLE="# Security Scan Report"
fi

cat << EOF
$FULL_TITLE

**Image:** \`$ARTIFACT_NAME\`
**Scan Date:** $CREATED_AT

## Summary

EOF

# Generate summary counts (always show all severities)
jq -r '
  [.Results[].Vulnerabilities // [] | .[]] as $vulns |
  ["CRITICAL", "HIGH", "MEDIUM", "LOW"] |
  map(. as $sev | {
    severity: $sev,
    count: ([$vulns[] | select(.Severity == $sev)] | length)
  }) |
  "| Severity | Count |",
  "| -------- | -----:|",
  (.[] | "| \(.severity) | \(.count) |"),
  "| **TOTAL** | **\($vulns | length)** |"
' "$JSON_FILE"

cat << 'EOF'

## High & Critical Vulnerabilities

EOF

# Check if there are any HIGH/CRITICAL
HIGH_CRITICAL_COUNT=$(jq '[.Results[].Vulnerabilities // [] | .[] | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' "$JSON_FILE")

if [[ "$HIGH_CRITICAL_COUNT" -eq 0 ]]; then
  echo "No HIGH or CRITICAL vulnerabilities found."
  echo ""
else
  # Check if any vulnerabilities are from dynamic-plugins-root
  HAS_PLUGINS=$(jq '[.Results[].Vulnerabilities // [] | .[] | select(.PkgPath != null) | select(.PkgPath | contains("dynamic-plugins-root"))] | length > 0' "$JSON_FILE")

  if [[ "$HAS_PLUGINS" == "true" ]]; then
    # Include Plugin column for dynamic plugins report
    jq -r '
      [.Results[] |
        select(.Vulnerabilities != null) |
        .Type as $type |
        .Vulnerabilities[] |
        select(.Severity == "HIGH" or .Severity == "CRITICAL") |
        {
          type: $type,
          pkg: .PkgName,
          vuln: .VulnerabilityID,
          severity: .Severity,
          installed: .InstalledVersion,
          fixed: (.FixedVersion // "-"),
          title: ((.Title // .Description // "No description") | gsub("\n"; " ") | .[0:50]),
          plugin: ((.PkgPath // "") | split("/") | if index("dynamic-plugins-root") then .[index("dynamic-plugins-root") + 1] else "-" end)
        }
      ] |
      unique_by(.vuln + .pkg) |
      group_by(.type) |
      .[] |
      (
        "### " + .[0].type + "\n",
        "| Plugin | Package | CVE | Severity | Installed | Fixed | Description |",
        "| ------ | ------- | --- | -------- | --------- | ----- | ----------- |",
        (.[] | "| " + .plugin + " | " + .pkg + " | " + .vuln + " | " + .severity + " | " + .installed + " | " + .fixed + " | " + .title + " |"),
        ""
      )
    ' "$JSON_FILE"
  else
    # Standard report without Plugin column
    jq -r '
      [.Results[] |
        select(.Vulnerabilities != null) |
        .Type as $type |
        .Vulnerabilities[] |
        select(.Severity == "HIGH" or .Severity == "CRITICAL") |
        {
          type: $type,
          pkg: .PkgName,
          vuln: .VulnerabilityID,
          severity: .Severity,
          installed: .InstalledVersion,
          fixed: (.FixedVersion // "-"),
          title: ((.Title // .Description // "No description") | gsub("\n"; " ") | .[0:60])
        }
      ] |
      unique_by(.vuln + .pkg) |
      group_by(.type) |
      .[] |
      (
        "### " + .[0].type + "\n",
        "| Package | CVE | Severity | Installed | Fixed | Description |",
        "| ------- | --- | -------- | --------- | ----- | ----------- |",
        (.[] | "| " + .pkg + " | " + .vuln + " | " + .severity + " | " + .installed + " | " + .fixed + " | " + .title + " |"),
        ""
      )
    ' "$JSON_FILE"
  fi
fi

cat << 'EOF'

## Actionable Vulnerabilities

Vulnerabilities with available fixes (HIGH/CRITICAL only):

EOF

# Show only HIGH/CRITICAL vulnerabilities with fixes, deduplicated
# Check if any vulnerabilities are from dynamic-plugins-root
HAS_PLUGINS_FIXABLE=$(jq '[.Results[].Vulnerabilities // [] | .[] | select(.FixedVersion) | select(.PkgPath != null) | select(.PkgPath | contains("dynamic-plugins-root"))] | length > 0' "$JSON_FILE")

if [[ "$HAS_PLUGINS_FIXABLE" == "true" ]]; then
  # Include Plugin column for dynamic plugins report
  FIXABLE=$(jq -r '
    [.Results[].Vulnerabilities // [] | .[] |
      select(.FixedVersion != null and .FixedVersion != "") |
      select(.Severity == "HIGH" or .Severity == "CRITICAL") |
      {
        pkg: .PkgName,
        vuln: .VulnerabilityID,
        severity: .Severity,
        installed: .InstalledVersion,
        fixed: .FixedVersion,
        plugin: ((.PkgPath // "") | split("/") | if index("dynamic-plugins-root") then .[index("dynamic-plugins-root") + 1] else "-" end)
      }
    ] |
    unique_by(.vuln + .pkg) |
    sort_by(if .severity == "CRITICAL" then 0 else 1 end)
  ' "$JSON_FILE")

  FIXABLE_COUNT=$(echo "$FIXABLE" | jq 'length')

  if [[ "$FIXABLE_COUNT" -eq 0 ]]; then
    echo "No HIGH/CRITICAL vulnerabilities with available fixes."
  else
    echo "| Plugin | Package | CVE | Severity | Installed | Fixed |"
    echo "| ------ | ------- | --- | -------- | --------- | ----- |"
    echo "$FIXABLE" | jq -r '.[] | "| \(.plugin) | \(.pkg) | \(.vuln) | \(.severity) | \(.installed) | \(.fixed) |"'
  fi
else
  # Standard report without Plugin column
  FIXABLE=$(jq -r '
    [.Results[].Vulnerabilities // [] | .[] |
      select(.FixedVersion != null and .FixedVersion != "") |
      select(.Severity == "HIGH" or .Severity == "CRITICAL") |
      {
        pkg: .PkgName,
        vuln: .VulnerabilityID,
        severity: .Severity,
        installed: .InstalledVersion,
        fixed: .FixedVersion
      }
    ] |
    unique_by(.vuln + .pkg) |
    sort_by(if .severity == "CRITICAL" then 0 else 1 end)
  ' "$JSON_FILE")

  FIXABLE_COUNT=$(echo "$FIXABLE" | jq 'length')

  if [[ "$FIXABLE_COUNT" -eq 0 ]]; then
    echo "No HIGH/CRITICAL vulnerabilities with available fixes."
  else
    echo "| Package | CVE | Severity | Installed | Fixed |"
    echo "| ------- | --- | -------- | --------- | ----- |"
    echo "$FIXABLE" | jq -r '.[] | "| \(.pkg) | \(.vuln) | \(.severity) | \(.installed) | \(.fixed) |"'
  fi
fi

cat << EOF

---

*Generated from Trivy scan results*
EOF
