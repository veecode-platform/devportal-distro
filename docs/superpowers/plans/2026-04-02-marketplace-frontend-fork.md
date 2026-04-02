# Marketplace Frontend Fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the RHDH extensions frontend plugin into devportal-distro, then modify it to support correct install states, uninstall, enable/disable toggle, built-in badge, and confirmation dialogs.

**Architecture:** Copy RHDH frontend source (`redhat-developer/rhdh-plugins` → `workspaces/extensions/plugins/extensions/src/`) into `dynamic-plugins/packages/devportal-marketplace-frontend/`. Create a Scalprum wrapper for dynamic loading. Disable the RHDH original and mount our fork at `/marketplace`. Keep `@red-hat-developer-hub/backstage-plugin-extensions-common` as npm dependency for types and API client.

**Tech Stack:** React 18, TypeScript, MUI v5, @tanstack/react-query v5, Backstage plugin SDK, Scalprum (dynamic loading via @janus-idp/cli)

**Spec:** `docs/superpowers/specs/2026-04-02-marketplace-frontend-fork-design.md`

---

## File Map

### New files
- `dynamic-plugins/packages/devportal-marketplace-frontend/` — forked RHDH frontend source
- `dynamic-plugins/packages/devportal-marketplace-frontend/UPSTREAM.md` — upstream commit ref
- `dynamic-plugins/packages/devportal-marketplace-frontend/package.json` — adapted for workspace
- `dynamic-plugins/packages/devportal-marketplace-frontend/tsconfig.json` — TypeScript config
- `dynamic-plugins/packages/devportal-marketplace-frontend/src/hooks/usePluginStatus.ts` — state derivation
- `dynamic-plugins/packages/devportal-marketplace-frontend/src/components/ConfirmActionDialog.tsx` — confirmation dialog
- `dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/package.json` — Scalprum wrapper
- `dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/src/index.ts` — re-export
- `dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/tsconfig.json`

### Modified files
- `dynamic-plugins/packages/devportal-marketplace-frontend/src/plugin.ts` — renamed exports
- `dynamic-plugins/packages/devportal-marketplace-frontend/src/components/PluginCard.tsx` — state badges + actions
- `dynamic-plugins.default.yaml` — disable RHDH frontend, add our fork
- `Dockerfile` — build + copy steps for the new plugin

---

## Task 1: Clone RHDH Source into Package

**Files:**
- Create: `dynamic-plugins/packages/devportal-marketplace-frontend/UPSTREAM.md`
- Create: `dynamic-plugins/packages/devportal-marketplace-frontend/src/` (entire directory from RHDH)

- [ ] **Step 1: Sparse-clone the RHDH plugins repo and copy the extensions frontend source**

```bash
cd /tmp
git clone --depth 1 --filter=blob:none --sparse https://github.com/redhat-developer/rhdh-plugins.git rhdh-plugins-sparse
cd rhdh-plugins-sparse
git sparse-checkout set workspaces/extensions/plugins/extensions/src
```

- [ ] **Step 2: Copy the src/ directory to our package**

```bash
mkdir -p /home/gio/devportal/devportal-distro/dynamic-plugins/packages/devportal-marketplace-frontend
cp -r /tmp/rhdh-plugins-sparse/workspaces/extensions/plugins/extensions/src \
      /home/gio/devportal/devportal-distro/dynamic-plugins/packages/devportal-marketplace-frontend/src
```

- [ ] **Step 3: Record the upstream commit for future cherry-picks**

Get the commit hash from the sparse clone and write UPSTREAM.md:

```bash
COMMIT=$(cd /tmp/rhdh-plugins-sparse && git rev-parse HEAD)
cat > /home/gio/devportal/devportal-distro/dynamic-plugins/packages/devportal-marketplace-frontend/UPSTREAM.md << EOF
# Upstream Reference

Source: https://github.com/redhat-developer/rhdh-plugins
Path: workspaces/extensions/plugins/extensions/
Commit: $COMMIT
Date: $(date -u +%Y-%m-%d)

To compare with upstream:
  git clone --depth 1 https://github.com/redhat-developer/rhdh-plugins.git /tmp/rhdh-upstream
  diff -r src/ /tmp/rhdh-upstream/workspaces/extensions/plugins/extensions/src/
EOF
```

- [ ] **Step 4: Clean up the sparse clone**

```bash
rm -rf /tmp/rhdh-plugins-sparse
```

- [ ] **Step 5: Verify the source tree looks complete**

```bash
find /home/gio/devportal/devportal-distro/dynamic-plugins/packages/devportal-marketplace-frontend/src -type f | wc -l
```

Expected: ~80+ files (components, hooks, pages, api, assets, etc.)

---

## Task 2: Create Package Configuration

**Files:**
- Create: `dynamic-plugins/packages/devportal-marketplace-frontend/package.json`
- Create: `dynamic-plugins/packages/devportal-marketplace-frontend/tsconfig.json`

- [ ] **Step 1: Create package.json**

Based on the RHDH original but adapted for our yarn workspace. Key changes: name, private, no publishConfig, pluginId stays `extensions` for API discovery compatibility, remove `alpha` export (we keep the directory for translations but don't need the export).

```json
{
  "name": "devportal-marketplace-frontend",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "license": "Apache-2.0",
  "private": true,
  "backstage": {
    "role": "frontend-plugin",
    "pluginId": "extensions",
    "pluginPackages": [
      "devportal-marketplace-frontend"
    ]
  },
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "typesVersions": {
    "*": {
      "package.json": [
        "package.json"
      ]
    }
  },
  "scripts": {
    "tsc": "node --max-old-space-size=8192 ../../node_modules/typescript/lib/tsc.js",
    "build": "backstage-cli package build",
    "clean": "backstage-cli package clean",
    "test": "backstage-cli package test"
  },
  "dependencies": {
    "@backstage/catalog-client": "^1.12.1",
    "@backstage/core-compat-api": "^0.2.0",
    "@backstage/core-components": "^0.18.3",
    "@backstage/core-plugin-api": "^1.12.0",
    "@backstage/frontend-defaults": "^0.3.0",
    "@backstage/frontend-plugin-api": "^0.14.0",
    "@backstage/plugin-app-react": "^0.2.0",
    "@backstage/plugin-catalog-react": "^1.21.3",
    "@backstage/theme": "^0.7.0",
    "@backstage/types": "^1.2.2",
    "@material-table/core": "^6.4.4",
    "@material-ui/core": "^4.12.2",
    "@monaco-editor/react": "^4.7.0",
    "@mui/icons-material": "^5.18.0",
    "@mui/material": "^5.18.0",
    "@red-hat-developer-hub/backstage-plugin-extensions-common": "^0.15.0",
    "@tanstack/react-query": "^5.60.5",
    "monaco-editor": "^0.55.0",
    "yaml": "^2.7.0"
  },
  "peerDependencies": {
    "react": "^18",
    "react-dom": "^18",
    "react-router-dom": "^6.3.0"
  },
  "devDependencies": {
    "@backstage/cli": "^0.34.1",
    "typescript": "5.9.3"
  },
  "files": [
    "dist"
  ]
}
```

Note: `@red-hat-developer-hub/backstage-plugin-extensions-common` uses a fixed npm version instead of `workspace:^` since it's not in our workspace.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "@backstage/cli/config/tsconfig.json",
  "include": ["src"],
  "exclude": ["node_modules"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 3: Verify package is recognized by the workspace**

```bash
cd /home/gio/devportal/devportal-distro/dynamic-plugins
yarn workspaces list | grep marketplace-frontend
```

Expected: `devportal-marketplace-frontend` appears in the workspace list.

---

## Task 3: Create Wrapper Package

**Files:**
- Create: `dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/package.json`
- Create: `dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/src/index.ts`
- Create: `dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/tsconfig.json`

- [ ] **Step 1: Create the wrapper directory**

```bash
mkdir -p /home/gio/devportal/devportal-distro/dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/src
```

- [ ] **Step 2: Create wrapper package.json**

Following the exact pattern of `devportal-pending-changes-dynamic`:

```json
{
  "name": "devportal-marketplace-frontend-dynamic",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "license": "Apache-2.0",
  "private": true,
  "backstage": {
    "role": "frontend-plugin",
    "pluginId": "extensions",
    "pluginPackages": [
      "devportal-marketplace-frontend",
      "devportal-marketplace-frontend-dynamic"
    ]
  },
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "tsc": "tsc",
    "build": "backstage-cli package build",
    "clean": "backstage-cli package clean",
    "clean-dynamic-sources": "yarn clean && rm -Rf node_modules",
    "export-dynamic": "janus-cli package export-dynamic-plugin --in-place --embed-package devportal-marketplace-frontend"
  },
  "dependencies": {
    "devportal-marketplace-frontend": "workspace:^"
  },
  "devDependencies": {
    "@backstage/cli": "^0.34.1",
    "@janus-idp/cli": "3.6.1",
    "typescript": "5.9.3"
  },
  "files": [
    "dist",
    "dist-scalprum"
  ],
  "scalprum": {
    "name": "devportal.marketplace-frontend",
    "exposedModules": {
      "PluginRoot": "./src/index.ts"
    }
  }
}
```

- [ ] **Step 3: Create wrapper index.ts**

```typescript
export * from 'devportal-marketplace-frontend';
```

- [ ] **Step 4: Create wrapper tsconfig.json**

```json
{
  "extends": "@backstage/cli/config/tsconfig.json",
  "include": ["src"],
  "exclude": ["node_modules"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

---

## Task 4: Update Build Pipeline

**Files:**
- Modify: `Dockerfile`
- Modify: `dynamic-plugins.default.yaml`

- [ ] **Step 1: Add build steps to Dockerfile**

In the Dockerfile, after the existing workspace build commands (line ~24-32), add the marketplace frontend build. Insert after `yarn workspace devportal-pending-changes-dynamic run tsc &&`:

```dockerfile
    yarn workspace devportal-marketplace-frontend run tsc && \
    yarn workspace devportal-marketplace-frontend run build && \
    yarn workspace devportal-marketplace-frontend-dynamic run tsc && \
```

These go BEFORE the final `yarn build && yarn export-dynamic` lines which handle the wrappers.

- [ ] **Step 2: Add copy step to Dockerfile**

After the existing `cp -a` commands (line ~52), add:

```dockerfile
    cp -a /app/dynamic-plugins/dist/devportal-marketplace-frontend-dynamic              /app/dynamic-plugins-root/
```

This copies the built Scalprum bundle to the pre-installed plugins directory.

- [ ] **Step 3: Disable RHDH frontend in dynamic-plugins.default.yaml**

Replace the current RHDH extensions frontend config (around lines 471-491) with disabled version:

```yaml
  # ── Extensions Marketplace ──────────────────────────────────────────
  # RHDH frontend — DISABLED (replaced by devportal fork)
  - package: red-hat-developer-hub-backstage-plugin-extensions
    preInstalled: true
    disabled: true
```

- [ ] **Step 4: Add our fork to dynamic-plugins.default.yaml**

Add after the disabled RHDH entry:

```yaml
  # DevPortal marketplace frontend (fork of RHDH extensions frontend)
  - package: devportal-marketplace-frontend-dynamic
    preInstalled: true
    pluginConfig:
      dynamicPlugins:
        frontend:
          devportal.marketplace-frontend:
            appIcons:
              - name: pluginsIcon
                importName: PluginsIcon
            dynamicRoutes:
              - path: /marketplace
                importName: DynamicExtensionsPluginRouter
                menuItem:
                  icon: pluginsIcon
                  text: Marketplace
            menuItems:
              marketplace:
                title: Marketplace
                icon: pluginsIcon
```

- [ ] **Step 5: Commit the fork setup**

```bash
git add dynamic-plugins/packages/devportal-marketplace-frontend/ \
        dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/ \
        Dockerfile \
        dynamic-plugins.default.yaml
git commit -m "feat: fork RHDH extensions frontend into devportal-marketplace-frontend"
```

---

## Task 5: First Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Install dependencies**

```bash
cd /home/gio/devportal/devportal-distro/dynamic-plugins
yarn install
```

If there are resolution errors (e.g. `@red-hat-developer-hub/backstage-plugin-extensions-common` version mismatch), add the correct version to the root `package.json` resolutions.

- [ ] **Step 2: Run TypeScript compilation**

```bash
cd /home/gio/devportal/devportal-distro/dynamic-plugins
yarn workspace devportal-marketplace-frontend run tsc
```

Fix any type errors. Common issues to expect:
- Missing `@backstage/ui` dependency (new package, may not be in registry yet — check if removable or add to deps)
- `alpha/` directory imports from packages not in our workspace — if these fail, the quickest fix is to remove the `alpha/` directory and strip the `extensionsTranslationRef` import from `plugin.ts`. Replace with a no-op translation setup.
- `@material-table/core` type issues

- [ ] **Step 3: Build the package**

```bash
yarn workspace devportal-marketplace-frontend run build
```

- [ ] **Step 4: Build and export the wrapper**

```bash
yarn workspace devportal-marketplace-frontend-dynamic run tsc
yarn workspace devportal-marketplace-frontend-dynamic run export-dynamic
```

Verify `dist-scalprum/` is created in the wrapper directory.

- [ ] **Step 5: Verify Scalprum bundle**

```bash
ls /home/gio/devportal/devportal-distro/dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/dist-scalprum/
```

Expected: `plugin-manifest.json` + JS chunks.

Check the manifest:
```bash
cat /home/gio/devportal/devportal-distro/dynamic-plugins/wrappers/devportal-marketplace-frontend-dynamic/dist-scalprum/plugin-manifest.json | head -20
```

Expected: `"name": "devportal.marketplace-frontend"`, with `DynamicExtensionsPluginRouter` and `PluginsIcon` in the exposed modules.

- [ ] **Step 6: Commit build fixes**

```bash
git add -A
git commit -m "fix: resolve build issues in marketplace frontend fork"
```

---

## Task 6: Add usePluginStatus Hook

**Files:**
- Create: `dynamic-plugins/packages/devportal-marketplace-frontend/src/hooks/usePluginStatus.ts`

This hook derives a per-plugin status by cross-referencing three data sources: the plugin catalog, loaded plugins, and pending changes.

- [ ] **Step 1: Create the hook file**

```typescript
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import {
  ExtensionsPlugin,
  ExtensionsPluginInstallStatus,
} from '@red-hat-developer-hub/backstage-plugin-extensions-common';
import { dynamicPluginsInfoApiRef } from '../api';

export type MarketplaceStatus =
  | 'available'
  | 'built-in'
  | 'installed'
  | 'disabled'
  | 'pending-install'
  | 'pending-removal';

interface PendingChangesResponse {
  count: number;
  pendingInstalls: string[];
  pendingRemovals: string[];
}

export const usePluginStatus = (plugin: ExtensionsPlugin): MarketplaceStatus => {
  const dynamicPluginsInfoApi = useApi(dynamicPluginsInfoApiRef);
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const { data: loadedPlugins } = useQuery({
    queryKey: ['loaded-plugins'],
    queryFn: () => dynamicPluginsInfoApi.listLoadedPlugins(),
    staleTime: 30_000,
  });

  const { data: pendingChanges } = useQuery<PendingChangesResponse>({
    queryKey: ['pending-changes'],
    queryFn: async () => {
      const baseUrl = await discoveryApi.getBaseUrl('extensions');
      const res = await fetchApi.fetch(`${baseUrl}/pending-changes`);
      if (!res.ok) return { count: 0, pendingInstalls: [], pendingRemovals: [] };
      return res.json();
    },
    staleTime: 10_000,
  });

  return useMemo(() => {
    const installStatus = plugin.spec?.installStatus;

    const pendingInstallNames = new Set(
      (pendingChanges?.pendingInstalls ?? []).map(extractName),
    );
    const pendingRemovalNames = new Set(
      (pendingChanges?.pendingRemovals ?? []).map(extractName),
    );
    const loadedNames = new Set(
      (loadedPlugins ?? []).map((p: { name: string }) => p.name),
    );

    // Check pending states first (highest priority — reflects current session actions)
    // plugin.spec.packages contains refs to Package catalog entities.
    // We match loaded plugins by checking if the plugin name is a substring of
    // any loaded plugin name (heuristic — works for our known plugin naming).
    const pluginName = plugin.metadata.name;

    // Check pending changes by scanning all pending lists for a name containing
    // the plugin's catalog name. This heuristic covers OCI and local paths.
    const hasPendingInstall = pendingChanges?.pendingInstalls?.some(
      pkg => extractName(pkg).includes(pluginName),
    ) ?? false;
    const hasPendingRemoval = pendingChanges?.pendingRemovals?.some(
      pkg => extractName(pkg).includes(pluginName),
    ) ?? false;

    if (hasPendingInstall) return 'pending-install';
    if (hasPendingRemoval) return 'pending-removal';

    // Check if loaded but not user-installed → built-in
    // A plugin is "loaded" if any loaded dynamic plugin name contains the catalog name.
    const isLoaded = loadedNames.size > 0 && Array.from(loadedNames).some(
      name => name.includes(pluginName),
    );
    const isInstalledByUser =
      installStatus === ExtensionsPluginInstallStatus.Installed ||
      installStatus === ExtensionsPluginInstallStatus.PartiallyInstalled ||
      installStatus === ExtensionsPluginInstallStatus.UpdateAvailable;

    if (isLoaded && !isInstalledByUser) return 'built-in';

    // Fall back to catalog install status
    if (installStatus === ExtensionsPluginInstallStatus.Disabled) return 'disabled';
    if (isInstalledByUser) return 'installed';

    return 'available';
  }, [plugin, loadedPlugins, pendingChanges]);
};

const extractName = (pkg: string): string => {
  const ociIdx = pkg.indexOf('!');
  if (ociIdx !== -1) return pkg.substring(ociIdx + 1);
  const lastSlash = pkg.lastIndexOf('/');
  if (lastSlash !== -1) return pkg.substring(lastSlash + 1);
  return pkg;
};
```

Note: The `pendingChanges` fetch uses `discoveryApiRef` + `fetchApiRef` directly because the RHDH `ExtensionsBackendClient` doesn't have a `getPendingChanges()` method — that's our custom endpoint. The matching between catalog plugin names and loaded/pending plugin names uses a substring heuristic (e.g. catalog name `about` matches loaded name `veecode-platform-backstage-plugin-about-dynamic`). This works for our known naming conventions. If edge cases arise, refine the matching logic.

- [ ] **Step 2: Verify the hook compiles**

```bash
cd /home/gio/devportal/devportal-distro/dynamic-plugins
yarn workspace devportal-marketplace-frontend run tsc
```

- [ ] **Step 3: Commit**

```bash
git add dynamic-plugins/packages/devportal-marketplace-frontend/src/hooks/usePluginStatus.ts
git commit -m "feat(marketplace): add usePluginStatus hook for state derivation"
```

---

## Task 7: Add Confirmation Dialog Component

**Files:**
- Create: `dynamic-plugins/packages/devportal-marketplace-frontend/src/components/ConfirmActionDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmActionDialog = ({
  open,
  title,
  message = 'This change will take effect after restart. Continue?',
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) => (
  <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <DialogContentText>{message}</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel}>Cancel</Button>
      <Button onClick={onConfirm} variant="contained" autoFocus>
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);
```

- [ ] **Step 2: Verify it compiles**

```bash
yarn workspace devportal-marketplace-frontend run tsc
```

- [ ] **Step 3: Commit**

```bash
git add dynamic-plugins/packages/devportal-marketplace-frontend/src/components/ConfirmActionDialog.tsx
git commit -m "feat(marketplace): add ConfirmActionDialog component"
```

---

## Task 8: Modify PluginCard with Status Badges and Actions

**Files:**
- Modify: `dynamic-plugins/packages/devportal-marketplace-frontend/src/components/PluginCard.tsx`

This is the core UX change. We replace the static `renderInstallStatus` with dynamic status from `usePluginStatus`, and add install/uninstall/toggle actions with confirmation dialogs.

- [ ] **Step 1: Read the current PluginCard.tsx from our fork**

Verify the file exists and matches the RHDH source we expect.

- [ ] **Step 2: Replace the renderInstallStatus function and add action buttons**

Replace the `renderInstallStatus` function and the bottom of the `PluginCard` component. The key changes:

1. Import `usePluginStatus` and `ConfirmActionDialog`
2. Import `useEnablePlugin` for install/uninstall/toggle mutations
3. Replace `renderInstallStatus` with a `PluginStatusBadge` that shows the correct state
4. Add action buttons (Install, Uninstall, Enable, Disable) based on status
5. Wrap actions in confirmation dialog

Replace the imports section at the top of PluginCard.tsx — add these new imports after the existing ones:

```typescript
import { useState, useCallback } from 'react';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import { usePluginStatus, MarketplaceStatus } from '../hooks/usePluginStatus';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { useEnablePlugin } from '../hooks/useEnablePlugin';
import { useQueryClient } from '@tanstack/react-query';
```

Replace the entire `renderInstallStatus` function with:

```typescript
const statusConfig: Record<MarketplaceStatus, {
  label: string;
  color: 'success' | 'warning' | 'error' | 'default' | 'info';
}> = {
  'available': { label: '', color: 'default' },
  'built-in': { label: 'Built-in', color: 'default' },
  'installed': { label: 'Installed', color: 'success' },
  'disabled': { label: 'Disabled', color: 'error' },
  'pending-install': { label: 'Pending install', color: 'warning' },
  'pending-removal': { label: 'Pending removal', color: 'warning' },
};

const PluginStatusBadge = ({ status }: { status: MarketplaceStatus }) => {
  const config = statusConfig[status];
  if (!config.label) return null;
  return (
    <Chip
      label={config.label}
      color={config.color}
      size="small"
      variant="outlined"
    />
  );
};
```

In the `PluginCard` component, add status derivation and action handling. Before the return statement, add:

```typescript
  const status = usePluginStatus(plugin);
  const queryClient = useQueryClient();
  const enableMutation = useEnablePlugin(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const invalidateQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pending-changes'] });
    queryClient.invalidateQueries({ queryKey: ['plugins'] });
  }, [queryClient]);

  const handleInstall = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmAction({
      title: 'Install plugin',
      confirmLabel: 'Install',
      onConfirm: () => {
        enableMutation.mutate(
          {
            namespace: plugin.metadata.namespace!,
            name: plugin.metadata.name,
            disabled: false,
          },
          { onSuccess: invalidateQueries },
        );
        setConfirmAction(null);
      },
    });
  }, [plugin, enableMutation, invalidateQueries]);

  const handleUninstall = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmAction({
      title: 'Uninstall plugin',
      confirmLabel: 'Uninstall',
      onConfirm: () => {
        enableMutation.mutate(
          {
            namespace: plugin.metadata.namespace!,
            name: plugin.metadata.name,
            disabled: true,
          },
          { onSuccess: invalidateQueries },
        );
        setConfirmAction(null);
      },
    });
  }, [plugin, enableMutation, invalidateQueries]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const enabling = status === 'disabled';
    setConfirmAction({
      title: enabling ? 'Enable plugin' : 'Disable plugin',
      confirmLabel: enabling ? 'Enable' : 'Disable',
      onConfirm: () => {
        enableMutation.mutate(
          {
            namespace: plugin.metadata.namespace!,
            name: plugin.metadata.name,
            disabled: !enabling,
          },
          { onSuccess: invalidateQueries },
        );
        setConfirmAction(null);
      },
    });
  }, [plugin, status, enableMutation, invalidateQueries]);
```

Replace the `CardActions` section at the bottom of the return JSX. Change:

```tsx
        {renderInstallStatus(plugin.spec?.installStatus)}
```

To:

```tsx
        <Stack direction="row" alignItems="center" spacing={1}>
          <PluginStatusBadge status={status} />
          {status === 'available' && (
            <Button size="small" variant="outlined" onClick={handleInstall}>
              Install
            </Button>
          )}
          {status === 'installed' && (
            <Button size="small" color="error" onClick={handleUninstall}>
              Uninstall
            </Button>
          )}
          {status === 'disabled' && (
            <Button size="small" color="primary" onClick={handleToggle}>
              Enable
            </Button>
          )}
          {status === 'built-in' && (
            <Button size="small" color="error" onClick={handleToggle}>
              Disable
            </Button>
          )}
        </Stack>
```

Add the confirmation dialog at the end of the return JSX, just before the closing `</Card>`:

```tsx
      <ConfirmActionDialog
        open={confirmAction !== null}
        title={confirmAction?.title ?? ''}
        confirmLabel={confirmAction?.confirmLabel}
        onConfirm={confirmAction?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmAction(null)}
      />
```

Remove the now-unused `renderInstallStatus` function and the `CheckCircleOutlineIcon` import.

- [ ] **Step 3: Verify it compiles**

```bash
yarn workspace devportal-marketplace-frontend run tsc
```

- [ ] **Step 4: Commit**

```bash
git add dynamic-plugins/packages/devportal-marketplace-frontend/src/components/PluginCard.tsx
git commit -m "feat(marketplace): add status badges, install/uninstall/toggle actions to PluginCard"
```

---

## Task 9: Docker Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Build the Docker image locally**

```bash
cd /home/gio/devportal/devportal-distro
docker buildx build . -t veecode/devportal:marketplace-test
```

This validates the entire pipeline: workspace install → tsc → build → export-dynamic → copy to dynamic-plugins-root.

If the build fails, the error will point to the specific step. Common issues:
- Missing dependency: add to package.json, re-run
- Type error in forked code: fix the specific file
- Scalprum export failure: check wrapper package.json scalprum config

- [ ] **Step 2: Start with docker compose**

```bash
cd /home/gio/devportal/devportal-distro
docker compose up --no-log-prefix
```

- [ ] **Step 3: Verify the marketplace loads**

Open `http://localhost:7007/marketplace` in a browser.

Check:
- [ ] Page loads without errors
- [ ] Plugin cards render with status badges
- [ ] "Built-in" badge appears on pre-installed plugins (about, pending-changes, etc.)
- [ ] "Available" plugins show Install button
- [ ] Install button opens confirmation dialog
- [ ] After confirming install, status changes to "Pending install"
- [ ] Pending changes badge in header updates

- [ ] **Step 4: Verify the old RHDH plugin is disabled**

Check browser DevTools console — there should be no errors about duplicate route registrations or conflicting plugin IDs.

Check that only `devportal.marketplace-frontend` appears in the loaded Scalprum modules (not `red-hat-developer-hub.backstage-plugin-extensions`).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(marketplace): resolve docker build and runtime issues"
```

---

## Task 10: Final Polish and Cleanup

**Files:**
- Modify: `dynamic-plugins/packages/devportal-marketplace-frontend/src/plugin.ts`

- [ ] **Step 1: Update plugin.ts exports**

The RHDH source exports deprecated aliases (`marketplacePlugin`, `MarketplaceFullPageRouter`, etc.). Since we're the canonical marketplace plugin now, clean up the exports. Keep only what we actually use:

In `plugin.ts`, ensure these exports exist (they should from the RHDH source):
- `DynamicExtensionsPluginRouter` — main router (used in dynamic-plugins.default.yaml)
- `PluginsIcon` — icon (used in dynamic-plugins.default.yaml)

Remove or leave deprecated aliases — they don't hurt but add noise. This is low priority.

- [ ] **Step 2: Verify no `@mui/material/styles` subpath imports**

Per known session pattern (MUI subpath imports break webpack Module Federation), grep for the problematic import:

```bash
grep -r "from '@mui/material/styles'" dynamic-plugins/packages/devportal-marketplace-frontend/src/
```

If found, convert to barrel import:
```typescript
// Before (breaks):
import { useTheme } from '@mui/material/styles';
// After (works):
import { useTheme } from '@mui/material';
```

Note: other MUI subpath imports like `import Button from '@mui/material/Button'` are fine — only `@mui/material/styles` is problematic.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(marketplace): marketplace frontend fork v1 complete"
```

---

## Summary of Commits

1. `feat: fork RHDH extensions frontend into devportal-marketplace-frontend` — source copy + package config + wrapper + Dockerfile + yaml
2. `fix: resolve build issues in marketplace frontend fork` — dependency fixes, type errors
3. `feat(marketplace): add usePluginStatus hook for state derivation` — cross-endpoint status logic
4. `feat(marketplace): add ConfirmActionDialog component` — reusable confirmation
5. `feat(marketplace): add status badges, install/uninstall/toggle actions to PluginCard` — core UX changes
6. `fix(marketplace): resolve docker build and runtime issues` — integration fixes
7. `feat(marketplace): marketplace frontend fork v1 complete` — final polish
