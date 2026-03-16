# Marketplace Auto-Config on Install

**Date:** 2026-03-16
**Status:** Approved
**Scope:** `devportal-marketplace-backend` in `devportal-distro`

## Problem

When a user installs a plugin via the marketplace UI, the backend writes only `package` + `disabled: false` to `extensions-install.yaml`. Without `pluginConfig`, frontend plugins don't mount in the UI and backend plugins don't configure their providers. The user must manually edit the YAML to add configuration — defeating the purpose of a self-service marketplace.

## Solution

On install, the backend reads `appConfigExamples[0].content` from the Package catalog entity and includes it as `pluginConfig` in the YAML entry. This provides sensible defaults (mount points, provider config) so plugins work immediately after restart.

### appConfigExamples Data Shape

The `appConfigExamples` field on Package entities is an array of objects. Each object has a `title` (string) and `content` (object — parsed JS/JSON, not a YAML string). Example from a frontend plugin entity:

```json
{
  "spec": {
    "appConfigExamples": [
      {
        "title": "Default configuration",
        "content": {
          "dynamicPlugins": {
            "frontend": {
              "backstage-community.plugin-github-actions": {
                "mountPoints": [
                  {
                    "mountPoint": "entity.page.ci/cards",
                    "importName": "EntityGithubActionsContent",
                    "config": { "layout": { "gridColumn": "1 / -1" } }
                  }
                ]
              }
            }
          }
        }
      }
    ]
  }
}
```

Backend plugin example (with env var placeholders):
```json
{
  "spec": {
    "appConfigExamples": [
      {
        "title": "Default configuration",
        "content": {
          "catalog": {
            "providers": {
              "threeScaleApiEntity": {
                "default": {
                  "baseUrl": "${THREESCALE_BASE_URL}",
                  "accessToken": "${THREESCALE_ACCESS_TOKEN}"
                }
              }
            }
          }
        }
      }
    ]
  }
}
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Env vars not set in config | Apply anyway | No RHDH frontend fork to show warnings; plugin fails silently until user sets vars |
| Multiple packages per plugin | Each gets its own `pluginConfig` | Matches existing YAML structure; `install-dynamic-plugins.py` merges at runtime |
| Multiple `appConfigExamples` | Use first (`[0]`) | All current entities have exactly one; simpler, covers 100% of cases |
| Entry already has `pluginConfig` | Don't overwrite | Respects manual edits by user |
| Where to put the logic | Router handler | Entity and context already available; less plumbing |

## Entry Points

Two endpoints trigger install:

| Endpoint | Scope | Current behavior |
|----------|-------|------------------|
| `PATCH /package/:ns/:name/configuration/disable` | Single package | `setPackageDisabled(artifact, false)` |
| `PATCH /plugin/:ns/:name/configuration/disable` | All packages of plugin | `setPluginDisabled(plugin, false)` |

Both need auto-config logic. In both cases, the Package entity (with `appConfigExamples`) is accessible:
- Package-level: via `getAuthorizedPackage()` → `extensionsApi.getPackageByName()`
- Plugin-level: via `extensionsApi.getPluginPackages()`

Note: `removeVerboseSpecContent` (which strips `appConfigExamples`) is only applied to GET list responses, not to these internal entity fetches.

## Auto-Config Logic

For each package being installed (`disabled: false`):

```
1. Does entity have appConfigExamples?
   NO  → write package + disabled only (current behavior)
   YES ↓

2. Does YAML entry already have pluginConfig?
   YES → preserve existing config, only set disabled: false
   NO  ↓

3. Read appConfigExamples[0].content from entity
4. Write entry: package + disabled: false + pluginConfig: <content>
```

When disabling (`disabled: true`): no change to current behavior. `setPackageDisabled` already preserves existing `pluginConfig`.

## Code Changes

### File: `router.ts`

**New helper function** `buildPackageYaml`:
- Accepts: `dynamicArtifact`, `disabled`, `extensionsPackage` entity, `existingConfig` (current YAML entry if any)
- **Returns: a YAML string** suitable for `updatePackageConfig()` (must pass `validatePackageFormat()`)
- If `existingConfig` has `pluginConfig` (parse the YAML string, check for key): update `disabled`, return (preserve manual edits)
- If entity has `appConfigExamples[0].content` (a JS object): serialize to YAML via `yaml` library's `Document`, build entry with `pluginConfig`
- Otherwise: build entry with just `package` + `disabled`
- Wrapped in try/catch: on error, log warning and fall back to simple `setPackageDisabled`

**Modified: Package-level disable handler** (`PATCH /package/:ns/:name/configuration/disable`):
- Before: calls `setPackageDisabled(artifact, disabled)`
- After: when `disabled === false`, reads existing config via `getPackageConfig(artifact)`, calls `buildPackageYaml`, uses `updatePackageConfig` to write full entry, adds `artifact` to `changedThisSession`
- When `disabled === true`, behavior unchanged

**Modified: Plugin-level disable handler** (`PATCH /plugin/:ns/:name/configuration/disable`):
- Before: calls `setPluginDisabled(plugin, disabled)`
- After: when `disabled === false`:
  1. Fetch all Package entities via `extensionsApi.getPluginPackages(plugin.metadata.namespace ?? DEFAULT_NAMESPACE, plugin.metadata.name)`
  2. For each package with `spec.dynamicArtifact`: read existing config, call `buildPackageYaml`, use `updatePackageConfig` to write
  3. Add each `dynamicArtifact` to `changedThisSession` (fixes pre-existing bug: plugin-level installs were not tracked for pending-changes)
- When `disabled === true`, behavior unchanged (calls `setPluginDisabled` as before)

### No changes to:
- `FileInstallationStorage.ts` — existing `updatePackage`, `getPackage` methods are sufficient
- `InstallationDataService.ts` — existing methods are sufficient
- `install-dynamic-plugins.py` — already reads `pluginConfig` from YAML
- RHDH frontend — no fork needed

## Edge Cases

| Case | Behavior |
|------|----------|
| `appConfigExamples` absent or empty array | Skip, install without config (current behavior) |
| `appConfigExamples[0].content` malformed | try/catch, log warning, fall back to install without config |
| Entry already exists with `pluginConfig` | Preserve existing config, only update `disabled` |
| Serialization (JS object → YAML) | Use `yaml` library's `Document` to serialize content as YAML node |
| Re-enable after disable | Entry still has `pluginConfig` from first install, preserved |
| Stale entry removed + reinstall | Entry was cleaned up, auto-config applies fresh |
| Plugin with N packages | Each gets individual `buildPackageYaml` call |
| Plugin also in `dynamic-plugins.yaml` main list | Main list entry overrides `pluginConfig` from `extensions-install.yaml` at merge time. Auto-config only effective for plugins not in the main list (OCI marketplace plugins). Pre-existing behavior, not introduced by this change. |
| `pluginConfig` conflicts between plugins at runtime | `install-dynamic-plugins.py` `merge()` raises `InstallException` on key conflicts. Not preventable by backend; same risk exists with manual config. |

## Example

Before (current behavior — install Todo plugin):
```yaml
plugins:
  - package: oci://quay.io/veecode/todo:bs_1.48.4!backstage-community-plugin-todo
    disabled: false
  - package: oci://quay.io/veecode/todo:bs_1.48.4!backstage-community-plugin-todo-backend
    disabled: false
```

After (with auto-config):
```yaml
plugins:
  - package: oci://quay.io/veecode/todo:bs_1.48.4!backstage-community-plugin-todo
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          backstage-community.plugin-todo:
            mountPoints:
              - mountPoint: entity.page.overview/cards
                importName: EntityTodoContent
                config:
                  layout:
                    gridColumn: 1 / -1
  - package: oci://quay.io/veecode/todo:bs_1.48.4!backstage-community-plugin-todo-backend
    disabled: false
```

(Todo backend has no `appConfigExamples`, so only the frontend package gets `pluginConfig`.)
