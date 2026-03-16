# Marketplace Auto-Config on Install — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-populate `pluginConfig` from Package entity `appConfigExamples` when installing plugins via the marketplace.

**Architecture:** A helper function `buildPackageYaml` reads `appConfigExamples[0].content` from the Package catalog entity and serializes it as `pluginConfig` in the YAML entry. Both package-level and plugin-level install handlers use this helper before writing to `extensions-install.yaml`.

**Tech Stack:** TypeScript, `yaml` library (already a dependency), Backstage catalog API

**Spec:** `docs/superpowers/specs/2026-03-16-marketplace-auto-config-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts` | Modify | Add `buildPackageYaml` helper, modify 2 handlers |

Single file change. No new files needed.

---

### Task 1: Add `buildPackageYaml` helper function

**Files:**
- Modify: `dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts`

- [ ] **Step 1: Add `yaml` import to router.ts**

Add at the top of the file (after line 34):

```typescript
import { Document, parseDocument } from 'yaml';
```

- [ ] **Step 2: Add `buildPackageYaml` helper**

Add inside `createRouter`, after the `extractPluginName` function (around line 525). This keeps it near the other helpers and within scope of `logger`:

```typescript
/**
 * Builds a YAML string for a single package entry, optionally including
 * pluginConfig from the Package entity's appConfigExamples[0].content.
 *
 * IMPORTANT: Always returns a YAML **map** (not a sequence), because
 * updatePackageConfig → validatePackageFormat expects isMap(contents).
 * Note: getPackageConfig() returns a YAML sequence (via toStringYaml),
 * so we must extract the map item from it, not return it as-is.
 *
 * - If existingConfig already has pluginConfig → preserves it (respects manual edits)
 * - If entity has appConfigExamples → includes first example as pluginConfig
 * - Otherwise → returns minimal entry with just package + disabled
 */
const buildPackageYaml = (
  dynamicArtifact: string,
  disabled: boolean,
  extensionsPackage: { spec?: { appConfigExamples?: Array<{ title?: string; content?: unknown }> } },
  existingConfig: string | undefined,
): string => {
  // Extract existing pluginConfig if present.
  // getPackageConfig returns a YAML sequence: "- package: ...\n  pluginConfig: ..."
  // We parse it and pull pluginConfig from the first (only) map item.
  let existingPluginConfig: unknown | undefined;
  if (existingConfig) {
    try {
      const doc = parseDocument(existingConfig);
      const seq = doc.contents as any;
      const firstItem = seq?.items?.[0];
      if (firstItem?.has?.('pluginConfig')) {
        existingPluginConfig = firstItem.toJSON?.().pluginConfig;
      }
    } catch {
      // If parsing fails, treat as no existing config
    }
  }

  // Always build a fresh document (single map, not sequence)
  const entry: Record<string, unknown> = {
    package: dynamicArtifact,
    disabled,
  };

  if (existingPluginConfig) {
    // Preserve manually-edited pluginConfig
    entry.pluginConfig = existingPluginConfig;
  } else {
    // Try to apply appConfigExamples[0].content as default pluginConfig
    try {
      const appConfigExamples = extensionsPackage.spec?.appConfigExamples;
      if (
        Array.isArray(appConfigExamples) &&
        appConfigExamples.length > 0 &&
        appConfigExamples[0].content &&
        typeof appConfigExamples[0].content === 'object'
      ) {
        entry.pluginConfig = appConfigExamples[0].content;
      }
    } catch (e) {
      logger.warn(
        `Failed to read appConfigExamples for ${dynamicArtifact}: ${e}`,
      );
    }
  }

  const doc = new Document(entry);
  return doc.toString({ lineWidth: 0 });
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/gio/devportal/devportal-distro/dynamic-plugins && yarn tsc --noEmit -p packages/devportal-marketplace-backend/tsconfig.json 2>&1 | head -20`

Expected: No errors (or only pre-existing errors unrelated to our change)

- [ ] **Step 4: Commit**

```bash
git add dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts
git commit -m "feat(marketplace): add buildPackageYaml helper for auto-config"
```

---

### Task 2: Modify package-level disable handler

**Files:**
- Modify: `dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts:286-312`

- [ ] **Step 1: Update the PATCH /package/:ns/:name/configuration/disable handler**

Replace the handler body (lines 300-310) with:

```typescript
      const disabled = req.body.disabled;
      if (typeof disabled !== 'boolean') {
        throw new InputError("'disabled' must be present boolean");
      }

      if (!disabled) {
        // Install: apply auto-config from appConfigExamples
        try {
          const existingConfig = installationDataService.getPackageConfig(
            extensionsPackage.spec.dynamicArtifact,
          );
          const yamlStr = buildPackageYaml(
            extensionsPackage.spec.dynamicArtifact,
            disabled,
            extensionsPackage,
            existingConfig,
          );
          installationDataService.updatePackageConfig(
            extensionsPackage.spec.dynamicArtifact,
            yamlStr,
          );
        } catch (e) {
          // Fallback: simple disable toggle without pluginConfig
          logger.warn(
            `Auto-config failed for ${extensionsPackage.spec.dynamicArtifact}, falling back to simple install: ${e}`,
          );
          installationDataService.setPackageDisabled(
            extensionsPackage.spec.dynamicArtifact,
            disabled,
          );
        }
      } else {
        // Disable: no auto-config needed
        installationDataService.setPackageDisabled(
          extensionsPackage.spec.dynamicArtifact,
          disabled,
        );
      }
      changedThisSession.add(extensionsPackage.spec.dynamicArtifact);
      res.status(200).json({ status: 'OK' });
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/gio/devportal/devportal-distro/dynamic-plugins && yarn tsc --noEmit -p packages/devportal-marketplace-backend/tsconfig.json 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts
git commit -m "feat(marketplace): auto-config on package-level install"
```

---

### Task 3: Modify plugin-level disable handler

**Files:**
- Modify: `dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts:441-456`

- [ ] **Step 1: Add DEFAULT_NAMESPACE import**

Add to the existing imports at the top of router.ts:

```typescript
import { DEFAULT_NAMESPACE } from '@backstage/catalog-model';
```

- [ ] **Step 2: Update the PATCH /plugin/:ns/:name/configuration/disable handler**

Replace the handler body (lines 449-454) with:

```typescript
      const disabled = req.body.disabled;
      if (typeof disabled !== 'boolean') {
        throw new InputError("'disabled' must be present boolean");
      }

      if (!disabled) {
        // Install: apply auto-config for each package in this plugin
        const packages = await extensionsApi.getPluginPackages(
          plugin.metadata.namespace ?? DEFAULT_NAMESPACE,
          plugin.metadata.name,
        );
        for (const pkg of packages) {
          const artifact = pkg.spec?.dynamicArtifact;
          if (!artifact) continue;

          try {
            const existingConfig =
              installationDataService.getPackageConfig(artifact);
            const yamlStr = buildPackageYaml(
              artifact,
              disabled,
              pkg,
              existingConfig,
            );
            installationDataService.updatePackageConfig(artifact, yamlStr);
          } catch (e) {
            logger.warn(
              `Auto-config failed for ${artifact}, falling back to simple install: ${e}`,
            );
            installationDataService.setPackageDisabled(artifact, disabled);
          }
          changedThisSession.add(artifact);
        }
      } else {
        // Disable: no auto-config needed, but track for pending-changes
        const disablePackages = await extensionsApi.getPluginPackages(
          plugin.metadata.namespace ?? DEFAULT_NAMESPACE,
          plugin.metadata.name,
        );
        await installationDataService.setPluginDisabled(plugin, disabled);
        for (const pkg of disablePackages) {
          if (pkg.spec?.dynamicArtifact) {
            changedThisSession.add(pkg.spec.dynamicArtifact);
          }
        }
      }
      res.status(200).json({ status: 'OK' });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/gio/devportal/devportal-distro/dynamic-plugins && yarn tsc --noEmit -p packages/devportal-marketplace-backend/tsconfig.json 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts
git commit -m "feat(marketplace): auto-config on plugin-level install

Also fixes pre-existing bug: plugin-level installs now tracked
in changedThisSession for accurate pending-changes count."
```

---

### Task 4: Manual integration test

- [ ] **Step 1: Reset extensions-install.yaml to clean state**

```bash
cat > /home/gio/devportal/devportal-distro/extensions-install.yaml << 'EOF'
plugins: []
EOF
```

- [ ] **Step 2: Restart DevPortal**

```bash
cd /home/gio/devportal/devportal-distro && docker compose restart devportal
```

- [ ] **Step 3: Test install via marketplace UI**

1. Open marketplace at `http://localhost:7007/extensions`
2. Find a plugin with known `appConfigExamples` (e.g., Todo, GitHub Actions)
3. Click Install
4. Verify `extensions-install.yaml` now has `pluginConfig` populated

- [ ] **Step 4: Verify pending-changes reports correctly**

```bash
curl -s http://localhost:7007/api/extensions/pending-changes | jq
```

Expected: `count > 0`, `pendingInstalls` contains the installed package

- [ ] **Step 5: Test disable preserves pluginConfig**

1. Disable the same plugin via marketplace UI
2. Check `extensions-install.yaml` — `pluginConfig` should still be present, `disabled: true`

- [ ] **Step 6: Test re-enable doesn't overwrite**

1. Re-enable the plugin
2. Check `extensions-install.yaml` — `pluginConfig` unchanged from original install

- [ ] **Step 7: Commit all remaining changes + tag RC3**

```bash
git add dynamic-plugins/packages/devportal-marketplace-backend/src/router.ts
git commit -m "feat(marketplace): auto-config on install

When installing plugins via marketplace, automatically populate
pluginConfig from Package entity appConfigExamples[0].content.
This ensures frontend plugins mount correctly and backend plugins
get default provider configuration without manual YAML editing."
```
