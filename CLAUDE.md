# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VeeCode DevPortal is a production-ready Backstage distribution built on the `veecode/devportal-base` image. This repository creates a derived Docker image that bundles pre-installed dynamic plugins without requiring code compilation.

## Architecture

### Docker Image Build Flow

1. **Build stage**: Processes `dynamic-plugins/` workspace (downloads + wrappers)
2. **Export**: Plugins exported to `dynamic-plugins-store/` during build
3. **Final image**: Plugins copied to `/app/dynamic-plugins/dist` for optional runtime loading

### Runtime Plugin Loading

- Entrypoint runs `install-dynamic-plugins.sh` which calls `install-dynamic-plugins.py`
- `dynamic-plugins.yaml` defines which plugins to enable/disable
- `dynamic-plugins.default.yaml` contains plugin default configurations
- Enabled plugins are copied to `/app/dynamic-plugins-root/` and automatically loaded

### Configuration Precedence (in order, later overrides earlier)

1. `app-config.yaml`
2. `app-config.production.yaml`
3. `app-config.dynamic-plugins.yaml`
4. `app-config.local.yaml`
5. `dynamic-plugins-root/app-config.dynamic-plugins.yaml`
6. `app-config.{profile}.yaml` (if `VEECODE_PROFILE` is set)

### Profile System

Set `VEECODE_PROFILE` environment variable to load profile-specific configs:

- `github-pat` - GitHub PAT authentication
- `github` - GitHub App authentication
- `azure` - Azure DevOps
- `keycloak` - Keycloak SSO
- `ldap` - LDAP authentication

## Key Files

- `plugins.json` - List of NPM plugins to download during build
- `dynamic-plugins.yaml` - Runtime plugin enable/disable config
- `dynamic-plugins.default.yaml` - Plugin default configurations with UI mount points
- `entrypoint.sh` - Container startup script handling config and plugins
- `docker/install-dynamic-plugins.py` - Python script that processes plugin config

## Common Commands

### Local Development

```bash
# Start DevPortal with hot reloading
docker compose up --no-log-prefix | npx --yes pino-pretty --colorize --translateTime

# Reprocess dynamic plugins config without restart
docker compose exec devportal /app/install-dynamic-plugins.sh /app/dynamic-plugins-root
```

### Dynamic Plugins Workspace

```bash
cd dynamic-plugins

# Install dependencies
yarn install --immutable

# Build all plugins
yarn build

# Export plugins for dynamic loading
yarn export-dynamic

# Copy built plugins to store
yarn copy-dynamic-plugins ../dynamic-plugins-store

# Create new wrapper plugin
yarn new-wrapper
```

### Building Docker Image

Push a tag to main branch (triggers GitHub Actions). Tags follow semver: `v1.2.3` or `1.2.3`.

For local builds:

```bash
docker build -t veecode/devportal:local .
```

## Adding Plugins

### NPM Plugins (build-time)

Edit `plugins.json`:

```json
{
  "plugins": [
    {
      "name": "@veecode-platform/backstage-plugin-example-dynamic",
      "version": "1.0.0"
    }
  ]
}
```

### Wrapper Plugins

For non-dynamic plugins, create a wrapper in `dynamic-plugins/wrappers/`. Use `yarn new-wrapper` or copy from [RHDH wrappers](https://github.com/redhat-developer/rhdh/tree/main/dynamic-plugins/wrappers).

### Plugin Configuration

Add plugin entry to `dynamic-plugins.default.yaml` with `pluginConfig` for frontend mount points:

```yaml
plugins:
  - package: ./dynamic-plugins/dist/my-plugin-dynamic
    disabled: true  # Default disabled, enable in dynamic-plugins.yaml
    pluginConfig:
      dynamicPlugins:
        frontend:
          my.plugin-name:
            mountPoints:
              - mountPoint: entity.page.overview/cards
                importName: MyComponent
```

## Environment Variables

Key variables for Docker runtime:

- `DEVELOPMENT=true` - Enables nodemon hot reload
- `VEECODE_PROFILE` - Selects authentication profile
- `GITHUB_TOKEN`, `GITHUB_ORG` - GitHub PAT auth
- `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` - GitHub App auth
- `AZURE_*` - Azure DevOps integration
- `VEECODE_APP_CONFIG` - Base64-encoded app-config (SaaS deployments)
- `VEECODE_DYNAMIC_PLUGINS` - Base64-encoded dynamic plugins config (SaaS deployments)
