# Marketplace Frontend Fork — Design Spec

**Date**: 2026-04-02
**Status**: Approved
**Backlog**: [Extensions Marketplace — UX & Improvements Backlog](https://www.notion.so/325882a1d62a81bca4fee44be552d498)

## Context

The current marketplace UI uses the RHDH frontend plugin (`red-hat-developer-hub-backstage-plugin-extensions`) which we have no control over. Known limitations:

- Install button gets "stuck" (checks `/loaded-plugins` which only updates after restart)
- No uninstall capability
- No toggle to re-enable disabled plugins
- No distinction between built-in and user-installed plugins
- No confirmation dialogs for destructive actions

The backend API (`devportal-marketplace-backend`) is fully custom and supports all required operations. The frontend is the bottleneck.

## Decision

Copy the RHDH extensions frontend plugin source code into the devportal-distro monorepo as a new package. This gives full control over UX while maintaining a reference to the upstream commit for future cherry-picks.

**Source**: `redhat-developer/rhdh-plugins` → `workspaces/extensions/plugins/extensions/`
**Target**: `dynamic-plugins/packages/devportal-marketplace-frontend/`

### Why copy, not GitHub fork

The RHDH plugin lives in a monorepo with hundreds of other plugins. Forking the entire repo for one plugin adds unnecessary weight (CI, deps, unrelated code). Copying the source into our monorepo with an `UPSTREAM.md` reference gives the same cherry-pick capability without the overhead.

### Why keep `extensions-common` as npm dependency

`@red-hat-developer-hub/backstage-plugin-extensions-common` contains types, permissions, and the `ExtensionsApi` interface. Our backend already depends on it. Copying it would create duplication without benefit — these types rarely change in breaking ways.

## Architecture

### Package Structure

```
dynamic-plugins/packages/devportal-marketplace-frontend/
├── UPSTREAM.md              # Commit/tag reference for cherry-picks
├── package.json             # backstage.role: frontend-plugin, pluginId: marketplace
├── tsconfig.json
└── src/
    ├── plugin.ts            # Plugin registration, API factories, component exports
    ├── routes.ts            # Route refs
    ├── index.ts             # Public exports
    ├── types.ts
    ├── consts.ts
    ├── labels.ts
    ├── utils.ts
    ├── queryclient.ts       # React Query setup
    ├── api/                 # API clients
    ├── hooks/               # 31 custom hooks (React Query based)
    ├── components/          # 42 components
    ├── pages/               # 13 page components
    ├── assets/
    └── shared-components/

dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/
├── package.json             # scalprum name: devportal.marketplace-frontend
└── src/
    └── index.ts             # export * from 'devportal-marketplace-frontend'
```

### Plugin Registration

In `plugin.ts`, the plugin registers with `pluginId: 'marketplace'` (distinct from the RHDH `extensions` pluginId). It provides:

- `DynamicMarketplaceRouter` — main router component (replaces `DynamicExtensionsPluginRouter`)
- `MarketplaceIcon` — reuse the existing power icon

### dynamic-plugins.default.yaml Changes

```yaml
# RHDH frontend — DISABLED (replaced by devportal fork)
- package: red-hat-developer-hub-backstage-plugin-extensions
  preInstalled: true
  pluginConfig:
    dynamicPlugins:
      frontend:
        red-hat-developer-hub.backstage-plugin-extensions:
          dynamicRoutes: []
          menuItems:
            marketplace:
              enabled: false

# DevPortal marketplace frontend (fork)
- package: devportal-marketplace-frontend-dynamic
  preInstalled: true
  pluginConfig:
    dynamicPlugins:
      frontend:
        devportal.marketplace-frontend:
          appIcons:
            - name: pluginsIcon
              importName: MarketplaceIcon
          dynamicRoutes:
            - path: /marketplace
              importName: DynamicMarketplaceRouter
              menuItem:
                icon: pluginsIcon
                text: Marketplace
          menuItems:
            marketplace:
              title: Marketplace
              icon: pluginsIcon
```

### Dockerfile Changes

Add build, export-dynamic, and copy steps following the same pattern as `devportal-pending-changes` and `devportal-marketplace-backend`:

```dockerfile
# Build marketplace frontend
RUN cd dynamic-plugins/packages/devportal-marketplace-frontend && yarn build
RUN cd dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic && yarn export-dynamic

# Copy to dynamic-plugins-root
COPY --from=build /app/dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/dist-scalprum \
     /app/dynamic-plugins-root/devportal-marketplace-frontend-dynamic
```

## Modifications (v1 Scope)

### 1. Plugin Card — Correct State Display

**Current**: Install button stays "stuck" after click (checks `/loaded-plugins`).

**New**: After successful backend POST, button immediately reflects the new state. No dependency on `/loaded-plugins` for immediate feedback.

State machine per plugin:

| loaded? | in install file? | disabled? | changedThisSession? | UI State |
|---------|-----------------|-----------|--------------------|--------------------|
| yes | no | — | — | **Built-in** (chip) |
| yes | yes | false | no | **Installed** (green) |
| no | yes | false | yes | **Pending install** (warning) |
| yes | yes | true | yes | **Pending removal** (warning) |
| no | yes | true | — | **Not installed** |
| no | no | — | — | **Available** (install btn) |

### 2. Uninstall

New "Uninstall" action on installed plugins. Calls `PATCH /plugin/:ns/:name/configuration/disable` with `{ disabled: true }`. Button transitions to "Pending removal". Integrates with pending-changes badge via `changedThisSession` tracking on the backend.

### 3. Toggle Enable/Disable

Switch component on disabled plugins. Calls `PATCH .../disable` with `{ disabled: false }` to re-enable. Resolves the RHDH limitation where "Disabled" is shown without any action available.

### 4. Badge "Built-in"

Plugins loaded from `dynamic-plugins.default.yaml` (present in `/loaded-plugins` but no entry in `extensions-install.yaml`) display a "Built-in" chip. These cannot be uninstalled — only disabled.

Detection logic: cross-reference `/loaded-plugins` with the plugin catalog. Plugins whose package path starts with `./dynamic-plugins/dist/` (pre-installed in the image) and are NOT present in `extensions-install.yaml` are built-in. Plugins installed via OCI (`oci://...`) or added to the install file by the user are user-installed. The `/loaded-plugins` endpoint returns the `name` and `platform` for each plugin — the path prefix distinguishes built-in from user-installed.

### 5. Confirmation Dialog

Every install/uninstall/toggle action opens a MUI `Dialog`:
- Title: action name (Install/Uninstall/Enable/Disable)
- Body: "This change will take effect after restart. Continue?"
- Actions: Cancel / Confirm

### 6. Backend Bypass Cleanup (NOT in v1)

The `/environment` and `/plugins/configure` bypass endpoints remain unchanged. They will be cleaned up after the RHDH frontend is fully disabled and the fork is validated in production.

## Data Flow

### API Endpoints Used

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /plugins` | Plugin catalog (metadata, descriptions) | No |
| `GET /loaded-plugins` | Currently running plugins | Yes |
| `GET /pending-changes` | Install/removal diff | No |
| `GET /plugin/:ns/:name/configuration` | Plugin YAML config | Yes |
| `PATCH /plugin/:ns/:name/configuration/disable` | Install/uninstall/toggle | Yes |
| `POST /plugin/:ns/:name/configuration` | Update config | Yes |

### State Derivation (Frontend)

Three parallel React Query calls:
1. `usePlugins()` — catalog data
2. `useLoadedPlugins()` — runtime state
3. `usePendingChanges()` — pending changes

A new `usePluginStatus()` hook merges these three into a per-plugin state map using the state machine table above. All three queries are lightweight and cached by React Query.

No new backend endpoint needed. If performance becomes an issue, a consolidated `GET /plugins/status` endpoint can be added later.

## Dependencies

### npm (existing)
- `@red-hat-developer-hub/backstage-plugin-extensions-common` — types, permissions, ExtensionsApi
- `@backstage/core-plugin-api`, `@backstage/core-components` — Backstage framework
- `@mui/material`, `@mui/icons-material` — UI components
- `react-query` / `@tanstack/react-query` — data fetching (whichever version the RHDH plugin uses)

### workspace (new)
- `devportal-marketplace-frontend` — source package
- `devportal-marketplace-frontend-dynamic` — wrapper for dynamic loading

## Testing Strategy

1. **Local**: `docker compose up` with the new plugin, verify `/marketplace` route loads
2. **Visual**: Browse plugins, verify state badges render correctly
3. **Functional**: Install → verify "Pending install" state → check pending-changes badge increments
4. **Uninstall**: Disable an installed plugin → verify "Pending removal" state
5. **Toggle**: Re-enable a disabled plugin → verify state transition
6. **Built-in**: Verify base image plugins show "Built-in" chip without install/uninstall actions
7. **Confirmation**: Every action triggers dialog before executing

## Risks

1. **RHDH plugin internal imports**: The plugin may import from internal Backstage packages not declared in its package.json. Will need to resolve these during build.
2. **React Query version mismatch**: RHDH may use a different version than what's in the distro's yarn workspace. Pin to the version used by the RHDH plugin.
3. **Scalprum compatibility**: The dynamic export via janus-cli must produce a valid Scalprum module. Follow the exact same pattern as `devportal-pending-changes-dynamic`.
4. **MUI barrel imports**: Per session pattern, MUI subpath imports break webpack Module Federation. The RHDH source likely uses subpath imports — these must be converted to barrel imports during the fork.
