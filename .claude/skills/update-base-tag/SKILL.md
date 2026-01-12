---
name: update-base-tag
description: Update TAG ARG in Dockerfile to latest veecode/devportal-base release
---

# Update Base Tag

Update the `TAG` ARG in the Dockerfile to the latest semver release of `veecode/devportal-base`.

## Instructions

1. **Fetch tags from Docker Hub**

   Use WebFetch to query the Docker Hub API for available tags (sorted by last updated):

   ```pre
   URL: https://hub.docker.com/v2/repositories/veecode/devportal-base/tags/?page_size=100&ordering=last_updated
   Prompt: List all semver tags (X.Y.Z format, no suffixes like -amd64 or -arm64) and identify the highest version number.
   ```

   Extract all tag names from the response.

2. **Filter and sort by semver**

   - Filter tags that match semver pattern: `X.Y.Z` (e.g., `1.2.3`, `1.1.70`)
   - Exclude tags like `latest`, `dev`, `main`, or any non-numeric tags
   - Sort tags by semver (major, minor, patch) in descending order
   - Select the highest version as the latest

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
   - The full tag that was found

## Example Output

```pre
Updated TAG in Dockerfile:
  Previous: 1.1.70
  New:      1.2.0
```

Or if already current:

```pre
Dockerfile is already up to date with TAG=1.1.70
```
