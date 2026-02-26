# Release Cycle — Distro Image

**Artifact:** `veecode/devportal:<version>` on Docker Hub

## Motivations

A distro image release is justified by one or more of:

- **New base image release** — A new `veecode/devportal-base` version was published
- **Distro plugin fixes/updates** — Fixes or updates to the many plugins embedded in the distro

## Flow

1. Make changes on `main` (update `ARG TAG` in Dockerfile, plugin changes, etc.)
2. Commit to `main`
3. Run `make release`

What `make release` does:

- Creates a new tag (patch bump from latest git tag)
- Pushes the tag

The tag push triggers CI (`.github/workflows/docker-build.yml`), which:

- Validates tag commit is on `main`
- Builds the Docker image (no source build — just layers on top of the base image)
- Publishes multi-arch image (amd64 + arm64) to Docker Hub

## Notes

The distro has no `package.json` version — the version **is** the git tag. There is no CHANGELOG generation.
