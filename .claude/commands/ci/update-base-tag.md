# Update Base Tag (CI)

Update the `TAG` ARG in the Dockerfile to the latest semver release of `veecode/devportal-base`.

This is the CI-compatible version that uses `curl` + `jq` instead of WebFetch.

## Steps

1. **Fetch all tags from Docker Hub** (paginated)

   Docker Hub returns at most 100 tags per page. Loop through all pages:

   ```bash
   TAGS=""
   URL="https://hub.docker.com/v2/repositories/veecode/devportal-base/tags/?page_size=100&ordering=last_updated"
   while [ -n "$URL" ] && [ "$URL" != "null" ]; do
     RESPONSE=$(curl -sf "$URL")
     PAGE_TAGS=$(echo "$RESPONSE" | jq -r '.results[].name')
     TAGS=$(printf '%s\n' "$TAGS" "$PAGE_TAGS")
     URL=$(echo "$RESPONSE" | jq -r '.next // empty')
   done
   ```

   If any `curl` call fails (non-zero exit), abort with an error. Do NOT
   proceed with an empty or missing tag list.

2. **Filter and select the highest semver tag**

   From the tag list, filter only tags matching strict semver `X.Y.Z` (three numeric segments).
   Exclude tags like `latest`, `dev`, `main`, or suffixed tags like `1.2.3-amd64`, `1.2.3-arm64`.

   ```bash
   LATEST=$(echo "$TAGS" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
   ```

   If `$LATEST` is empty, abort with an error — no valid semver tags were found.

3. **Read the current Dockerfile**

   Read the Dockerfile in the project root and find the current `TAG` value in the `ARG TAG=X.Y.Z` line.

4. **Compare versions**

   - If the latest Docker Hub tag is newer than the current TAG, update it
   - If they are the same, report that the Dockerfile is already up to date

5. **Update the Dockerfile**

   Use the Edit tool to replace the `ARG TAG=` line with the new version:

   ```dockerfile
   ARG TAG=<latest_version>
   ```

6. **Report the result**

   Output a summary:
   - Previous version
   - New version (or "already up to date")
