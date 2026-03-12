# Consuming OCI Dynamic Plugins

DevPortal supports loading dynamic plugins from OCI (Open Container Initiative) registries at startup. This allows adding plugins without rebuilding the Docker image.

## How it works

1. You reference an OCI image in `dynamic-plugins.yaml`
2. At startup, `install-dynamic-plugins.py` uses `skopeo` to pull the image
3. The plugin is extracted to `/app/dynamic-plugins-root/`
4. Frontend plugins are loaded by Scalprum, backend plugins by Node

## OCI package URL format

```
oci://<registry>/<image>:<tag>!<plugin-directory>
```

- `<registry>/<image>` — full OCI image path (e.g. `quay.io/veecode/todo` for workspace bundles)
- `<tag>` — image tag (e.g. `bs_1.48.4` for workspace bundles, or `1.0.0`)
- `!<plugin-directory>` — directory name inside the OCI layer where the plugin files live

Plugins are bundled by workspace — one OCI image per workspace containing all its plugins. Each plugin is extracted by its `!<plugin-directory>` suffix.

Example (workspace bundle with multiple plugins):

```
oci://quay.io/veecode/todo:bs_1.48.4!backstage-community-plugin-todo
oci://quay.io/veecode/todo:bs_1.48.4!backstage-community-plugin-todo-backend
```

## Adding an OCI plugin

### 1. Add the plugin entry

Edit `dynamic-plugins.yaml` and add an entry under `plugins`:

```yaml
plugins:
  # Backend plugin (no pluginConfig needed)
  - package: oci://quay.io/veecode/my-workspace:bs_1.48.4!my-plugin-backend
    disabled: false

  # Frontend plugin (needs pluginConfig for UI mount points)
  - package: oci://quay.io/veecode/my-workspace:bs_1.48.4!my-plugin
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          my-org.plugin-name:
            mountPoints:
              - mountPoint: entity.page.overview/cards
                importName: MyComponent
                config:
                  layout:
                    gridColumn: '1 / -1'
```

### 2. Frontend plugin configuration

Frontend plugins need `pluginConfig` to tell Scalprum where to render them. Common mount points:

| Mount Point | Where it appears |
|-------------|-----------------|
| `entity.page.overview/cards` | Entity overview tab |
| `entity.page.ci/cards` | Entity CI tab |
| `entity.page.docs/cards` | Entity docs tab |
| `root/header` | Global header banner |

Each OCI plugin may include an `app-config.dynamic.yaml` file with its recommended mount point configuration. Check the plugin documentation or inspect the file inside the OCI image.

### 3. Backend plugin configuration

Backend plugins typically don't need `pluginConfig` — they register their routes automatically. If a backend plugin needs app-config values (API keys, URLs, etc.), add them to `app-config.yaml` or `app-config.local.yaml` as documented by the plugin.

## Pull policy

| Policy | Behavior | Default for |
|--------|----------|-------------|
| `IfNotPresent` | Skip download if already installed | Most packages |
| `Always` | Always check for updates | Tags ending with `:latest!` |

Override per plugin:

```yaml
- package: oci://registry/image:tag!dir
  disabled: false
  pullPolicy: Always
```

## Registry authentication

### Private registries

If the OCI registry requires authentication, mount your Docker credentials into the container:

```yaml
# docker-compose.yml
services:
  devportal:
    volumes:
      - ~/.docker/config.json:/opt/app-root/src/.docker/config.json:ro
      - ~/.docker/config.json:/run/containers/0/auth.json:ro
```

The container runs as UID 1001, so the config file must be readable:

```bash
# Login to your registry
docker login <registry> -u <username> -p <token>

# Make config readable by the container
chmod 644 ~/.docker/config.json
```

Two mount paths are needed because:
- `/opt/app-root/src/.docker/config.json` — Docker client format
- `/run/containers/0/auth.json` — skopeo/containers default auth path

### Public registries

No authentication needed. Just reference the OCI image directly.

### Kubernetes deployments

For Kubernetes, create a Secret with registry credentials and mount it in the init container that runs `install-dynamic-plugins.py`:

```yaml
# Example: create a secret for quay.io
kubectl create secret docker-registry oci-registry-auth \
  --docker-server=quay.io \
  --docker-username=<user> \
  --docker-password=<token>
```

Mount it at `/opt/app-root/src/.docker/config.json` in the init container spec.

## Troubleshooting

### Plugin not appearing in UI

1. Check logs for `Successfully installed dynamic plugin oci://...`
2. Verify `pluginConfig` mount points are correct for frontend plugins
3. Some plugins only show on entities with specific annotations

### Authentication errors

```
unable to retrieve auth token: invalid username/password: unauthorized
```

- Ensure Docker credentials are mounted and readable (chmod 644)
- Verify the token has read access to the registry (e.g. robot account for quay.io)
- Both auth paths must be mounted (`~/.docker/config.json` and `/run/containers/0/auth.json`)

### Plugin installed but config not applied

The `pluginConfig` is only merged when the plugin is actually installed (not skipped). If you change `pluginConfig` after the first install, restart the container (`docker compose down && docker compose up`) to force a fresh install.
