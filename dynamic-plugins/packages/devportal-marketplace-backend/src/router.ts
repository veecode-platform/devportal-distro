import express, { Request, Response, NextFunction } from 'express';
import Router from 'express-promise-router';
import { InputError, NotAllowedError } from '@backstage/errors';
import type { Config } from '@backstage/config';

import {
  HttpAuthService,
  PermissionsService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  BasicPermission,
  PolicyDecision,
  ResourcePermission,
} from '@backstage/plugin-permission-common';

import {
  decodeGetEntitiesRequest,
  decodeGetEntityFacetsRequest,
  extensionsPluginWritePermission,
  extensionsPluginReadPermission,
  ExtensionsApi,
  ExtensionsPlugin,
  RESOURCE_TYPE_EXTENSIONS_PLUGIN,
  extensionsPermissions,
} from '@red-hat-developer-hub/backstage-plugin-extensions-common';
import { createPermissionIntegrationRouter } from '@backstage/plugin-permission-node';
import { createSearchParams } from './utils/createSearchParams';
import { removeVerboseSpecContent } from './utils/removeVerboseSpecContent';
import { rules as extensionRules } from './permissions/rules';
import { matches } from './utils/permissionUtils';
import { InstallationDataService } from './installation/InstallationDataService';
import { ConfigFormatError } from './errors/ConfigFormatError';
import { Document, parseDocument } from 'yaml';
import { toBlockStyle } from './utils/yamlFormat';
import { DEFAULT_NAMESPACE } from '@backstage/catalog-model';

import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import {
  BaseDynamicPlugin,
  DynamicPluginProvider,
} from '@backstage/backend-dynamic-feature-service';

export type ExtensionsRouterOptions = {
  httpAuth: HttpAuthService;
  extensionsApi: ExtensionsApi;
  permissions: PermissionsService;
  installationDataService: InstallationDataService;
  pluginProvider: DynamicPluginProvider;
  logger: LoggerService;
  config: Config;
};

export async function createRouter(
  options: ExtensionsRouterOptions,
): Promise<express.Router> {
  const {
    httpAuth,
    extensionsApi,
    permissions,
    installationDataService,
    pluginProvider,
    logger,
    config,
  } = options;

  const requireInitializedInstallationDataService = (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    const error = installationDataService.getInitializationError();
    if (error) {
      throw error;
    }
    next();
  };

  const router = Router();
  const permissionsIntegrationRouter = createPermissionIntegrationRouter({
    resourceType: RESOURCE_TYPE_EXTENSIONS_PLUGIN,
    permissions: extensionsPermissions,
    rules: Object.values(extensionRules),
  });
  router.use(express.json());
  router.use(permissionsIntegrationRouter);

  const authorizeConditional = async (
    request: Request,
    permission: ResourcePermission<'extensions-plugin'> | BasicPermission,
  ) => {
    const credentials = await httpAuth.credentials(request);
    let decision: PolicyDecision;
    // No permission configured, always allow.
    if (!permission) {
      return { result: AuthorizeResult.ALLOW };
    }

    if (permission.type === 'resource') {
      decision = (
        await permissions.authorizeConditional([{ permission }], {
          credentials,
        })
      )[0];
    } else {
      decision = (
        await permissions.authorize([{ permission }], {
          credentials,
        })
      )[0];
    }

    return decision;
  };

  const getAuthorizedPlugin = async (
    request: Request,
    permission: ResourcePermission<'extensions-plugin'> | BasicPermission,
  ) => {
    const decision = await authorizeConditional(request, permission);

    if (decision.result === AuthorizeResult.DENY) {
      throw new NotAllowedError(
        `Not allowed to ${permission.attributes.action} the configuration of ${request.params.namespace}:${request.params.name}`,
      );
    }

    const plugin = await extensionsApi.getPluginByName(
      request.params.namespace,
      request.params.name,
    );

    const hasAccess =
      decision.result === AuthorizeResult.ALLOW ||
      (decision.result === AuthorizeResult.CONDITIONAL &&
        matches(plugin, decision.conditions));
    if (!hasAccess) {
      throw new NotAllowedError(
        `Not allowed to ${permission.attributes.action} the configuration of ${request.params.namespace}:${request.params.name}`,
      );
    }

    return plugin;
  };

  const getAuthorizedPackage = async (
    request: Request,
    permission: ResourcePermission<'extensions-plugin'> | BasicPermission,
  ) => {
    const decision = await authorizeConditional(request, permission);

    if (decision.result === AuthorizeResult.DENY) {
      throw new NotAllowedError(
        `Not allowed to ${permission.attributes.action} the configuration of ${request.params.namespace}:${request.params.name}`,
      );
    }

    const packagePlugins = await extensionsApi.getPackagePlugins(
      request.params.namespace,
      request.params.name,
    );
    const hasAccess =
      decision.result === AuthorizeResult.ALLOW ||
      (decision.result === AuthorizeResult.CONDITIONAL &&
        packagePlugins.some(plugin => matches(plugin, decision.conditions)));
    if (!hasAccess) {
      throw new NotAllowedError(
        `Not allowed to ${permission.attributes.action} the configuration of ${request.params.namespace}:${request.params.name}`,
      );
    }

    return await extensionsApi.getPackageByName(
      request.params.namespace,
      request.params.name,
    );
  };

  // ─── Collection routes ──────────────────────────────────────────────

  router.get('/collections', async (req, res) => {
    const request = decodeGetEntitiesRequest(createSearchParams(req));
    const collections = await extensionsApi.getCollections(request);
    res.json(collections);
  });

  router.get('/collections/facets', async (req, res) => {
    const request = decodeGetEntityFacetsRequest(createSearchParams(req));
    const facets = await extensionsApi.getCollectionsFacets(request);
    res.json(facets);
  });

  router.get('/collection/:namespace/:name', async (req, res) => {
    const collection = await extensionsApi.getCollectionByName(
      req.params.namespace,
      req.params.name,
    );
    res.json(collection);
  });

  router.get('/collection/:namespace/:name/plugins', async (req, res) => {
    const plugins = await extensionsApi.getCollectionPlugins(
      req.params.namespace,
      req.params.name,
    );
    res.json(removeVerboseSpecContent(plugins));
  });

  // ─── Package routes ─────────────────────────────────────────────────

  router.get('/packages', async (req, res) => {
    const request = decodeGetEntitiesRequest(createSearchParams(req));
    const packages = await extensionsApi.getPackages(request);
    res.json({ ...packages, items: removeVerboseSpecContent(packages.items) });
  });

  router.get('/packages/facets', async (req, res) => {
    const request = decodeGetEntityFacetsRequest(createSearchParams(req));
    const facets = await extensionsApi.getPackagesFacets(request);
    res.json(facets);
  });

  router.get('/package/:namespace/:name', async (req, res) => {
    res.json(
      await extensionsApi.getPackageByName(
        req.params.namespace,
        req.params.name,
      ),
    );
  });

  router.get(
    '/package/:namespace/:name/configuration',
    requireInitializedInstallationDataService,
    async (req, res) => {
      const extensionsPackage = await getAuthorizedPackage(
        req,
        extensionsPluginReadPermission,
      );

      if (!extensionsPackage.spec?.dynamicArtifact) {
        throw new Error(
          `Package catalog entity ${extensionsPackage.metadata.name} is missing 'spec.dynamicArtifact'`,
        );
      }
      const result = await installationDataService.getPackageConfig(
        extensionsPackage.spec?.dynamicArtifact,
      );
      res.status(200).json({ configYaml: result });
    },
  );

  router.post(
    '/package/:namespace/:name/configuration',
    requireInitializedInstallationDataService,
    async (req, res) => {
      const extensionsPackage = await getAuthorizedPackage(
        req,
        extensionsPluginWritePermission,
      );
      if (!extensionsPackage.spec?.dynamicArtifact) {
        throw new Error(
          `Package ${extensionsPackage.metadata.name} is missing 'spec.dynamicArtifact'`,
        );
      }

      const newConfig = req.body.configYaml;
      if (!newConfig) {
        throw new InputError("'configYaml' object must be present");
      }
      try {
        await installationDataService.updatePackageConfig(
          extensionsPackage.spec.dynamicArtifact,
          newConfig,
        );
        changedThisSession.add(extensionsPackage.spec.dynamicArtifact);
      } catch (e) {
        if (e instanceof ConfigFormatError) {
          throw new InputError(e.message);
        }
        throw e;
      }
      res.status(200).json({ status: 'OK' });
    },
  );

  router.patch(
    '/package/:namespace/:name/configuration/disable',
    requireInitializedInstallationDataService,
    async (req, res) => {
      const extensionsPackage = await getAuthorizedPackage(
        req,
        extensionsPluginWritePermission,
      );

      if (!extensionsPackage.spec?.dynamicArtifact) {
        throw new Error(
          `Package catalog entity ${extensionsPackage.metadata.name} is missing 'spec.dynamicArtifact'`,
        );
      }

      const disabled = req.body.disabled;
      if (typeof disabled !== 'boolean') {
        throw new InputError("'disabled' must be present boolean");
      }

      if (!disabled) {
        // Install: apply auto-config from appConfigExamples
        try {
          const existingConfig = await installationDataService.getPackageConfig(
            extensionsPackage.spec.dynamicArtifact,
          );
          const yamlStr = buildPackageYaml(
            extensionsPackage.spec.dynamicArtifact,
            disabled,
            extensionsPackage,
            existingConfig,
          );
          await installationDataService.updatePackageConfig(
            extensionsPackage.spec.dynamicArtifact,
            yamlStr,
          );
        } catch (e) {
          // Fallback: simple disable toggle without pluginConfig
          logger.warn(
            `Auto-config failed for ${extensionsPackage.spec.dynamicArtifact}, falling back to simple install: ${e}`,
          );
          await installationDataService.setPackageDisabled(
            extensionsPackage.spec.dynamicArtifact,
            disabled,
          );
        }
      } else {
        // Disable: no auto-config needed
        await installationDataService.setPackageDisabled(
          extensionsPackage.spec.dynamicArtifact,
          disabled,
        );
      }
      changedThisSession.add(extensionsPackage.spec.dynamicArtifact);
      res.status(200).json({ status: 'OK' });
    },
  );

  // ─── Plugin routes ──────────────────────────────────────────────────

  router.get('/plugins', async (req, res) => {
    const request = decodeGetEntitiesRequest(createSearchParams(req));
    const plugins = await extensionsApi.getPlugins(request);
    res.json({ ...plugins, items: removeVerboseSpecContent(plugins.items) });
  });

  router.get('/plugins/facets', async (req, res) => {
    const request = decodeGetEntityFacetsRequest(createSearchParams(req));
    const facets = await extensionsApi.getPluginFacets(request);
    res.json(facets);
  });

  // ─── MODIFIED: always report installation as enabled ────────────────
  // INTENTIONAL BYPASS: The RHDH extensions frontend checks this endpoint
  // to decide whether to show the Install button. The upstream backend
  // returns { enabled: false } when NODE_ENV !== 'development' or when
  // config `extensions.installation.enabled` is not set.
  //
  // We unconditionally return { enabled: true } because our distribution
  // is designed for self-service plugin management in production.
  //
  // When we fork the RHDH frontend (roadmap), replace this with a proper
  // config flag (e.g. `extensions.installation.enabled: true` in app-config)
  // and let the frontend check that instead.
  router.get('/plugins/configure', async (_req, res) => {
    res.json({ enabled: true });
  });

  router.get('/plugin/:namespace/:name', async (req, res) => {
    const plugin = await extensionsApi.getPluginByName(
      req.params.namespace,
      req.params.name,
    );
    res.json(plugin);
  });

  router.get(
    '/plugin/:namespace/:name/configuration/authorize',
    async (req, res) => {
      const [readDecision, installDecision] = await Promise.all([
        authorizeConditional(req, extensionsPluginReadPermission),
        authorizeConditional(req, extensionsPluginWritePermission),
      ]);
      if (
        readDecision.result === AuthorizeResult.DENY &&
        installDecision.result === AuthorizeResult.DENY
      ) {
        res.status(200).json({ read: 'DENY', write: 'DENY' });
        return;
      }

      let authorizedActions = {};

      // Pre-fetch plugin if either decision needs conditional evaluation
      // to avoid duplicate fetches from concurrent promises.
      let plugin: ExtensionsPlugin | undefined;
      if (
        readDecision.result === AuthorizeResult.CONDITIONAL ||
        installDecision.result === AuthorizeResult.CONDITIONAL
      ) {
        plugin = await extensionsApi.getPluginByName(
          req.params.namespace,
          req.params.name,
        );
      }

      const evaluateConditional = (
        decision: PolicyDecision,
        action: string,
      ) => {
        if (decision.result === AuthorizeResult.CONDITIONAL) {
          if (plugin && matches(plugin, decision.conditions)) {
            authorizedActions = { ...authorizedActions, [action]: 'ALLOW' };
          }
        } else if (decision.result === AuthorizeResult.ALLOW) {
          authorizedActions = { ...authorizedActions, [action]: 'ALLOW' };
        }
      };

      evaluateConditional(readDecision, 'read');
      evaluateConditional(installDecision, 'write');

      if (Object.keys(authorizedActions).length === 0) {
        res.status(200).json({ read: 'DENY', write: 'DENY' });
      } else {
        res.status(200).json(authorizedActions);
      }
    },
  );

  router.get(
    '/plugin/:namespace/:name/configuration',
    requireInitializedInstallationDataService,
    async (req, res) => {
      const plugin = await getAuthorizedPlugin(
        req,
        extensionsPluginReadPermission,
      );
      const result = await installationDataService.getPluginConfig(plugin);
      res.status(200).json({ configYaml: result });
    },
  );

  router.post(
    '/plugin/:namespace/:name/configuration',
    requireInitializedInstallationDataService,
    async (req, res) => {
      const plugin = await getAuthorizedPlugin(
        req,
        extensionsPluginWritePermission,
      );

      const newConfig = req.body.configYaml;
      if (!newConfig) {
        throw new InputError("'configYaml' object must be present");
      }

      // Auto-config: enrich each package entry with appConfigExamples
      // if the frontend-provided configYaml doesn't include pluginConfig.
      try {
        const packages = await extensionsApi.getPluginPackages(
          plugin.metadata.namespace ?? DEFAULT_NAMESPACE,
          plugin.metadata.name,
        );
        for (const pkg of packages) {
          const artifact = pkg.spec?.dynamicArtifact;
          if (!artifact) continue;

          const existingConfig =
            await installationDataService.getPackageConfig(artifact);
          const yamlStr = buildPackageYaml(
            artifact,
            false,
            pkg,
            existingConfig,
          );
          await installationDataService.updatePackageConfig(artifact, yamlStr);
          changedThisSession.add(artifact);
        }
      } catch (e) {
        // Fallback: use the frontend-provided configYaml as-is
        logger.warn(
          `Auto-config failed for plugin ${plugin.metadata.name}, falling back to frontend config: ${e}`,
        );
        try {
          await installationDataService.updatePluginConfig(plugin, newConfig);
        } catch (e2) {
          if (e2 instanceof ConfigFormatError) {
            throw new InputError(e2.message);
          }
          throw e2;
        }
      }
      res.status(200).json({ status: 'OK' });
    },
  );

  router.patch(
    '/plugin/:namespace/:name/configuration/disable',
    requireInitializedInstallationDataService,
    async (req, res) => {
      const plugin = await getAuthorizedPlugin(
        req,
        extensionsPluginWritePermission,
      );
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
              await installationDataService.getPackageConfig(artifact);
            const yamlStr = buildPackageYaml(
              artifact,
              disabled,
              pkg,
              existingConfig,
            );
            await installationDataService.updatePackageConfig(artifact, yamlStr);
          } catch (e) {
            logger.warn(
              `Auto-config failed for ${artifact}, falling back to simple install: ${e}`,
            );
            await installationDataService.setPackageDisabled(artifact, disabled);
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
    },
  );

  router.get('/plugin/:namespace/:name/packages', async (req, res) => {
    const packages = await extensionsApi.getPluginPackages(
      req.params.namespace,
      req.params.name,
    );
    res.json(packages);
  });

  // ─── MODIFIED: always report development environment ────────────────
  // INTENTIONAL BYPASS: The RHDH extensions frontend gates the Install
  // button behind `nodeEnv === 'development'`. In production this endpoint
  // would return 'production', disabling installs entirely.
  //
  // This is a *scoped lie* — it only affects the extensions frontend;
  // it does NOT change process.env.NODE_ENV or affect any other plugin.
  //
  // Risk: if RHDH upstream adds security checks gated on nodeEnv in this
  // endpoint, they will be silently bypassed. Monitor RHDH changelogs on
  // the extensions plugin when upgrading.
  //
  // TODO: Replace with a custom `installEnabled` config flag when the
  // RHDH frontend is forked. See: project_marketplace_north_star.md
  router.get('/environment', async (_req, res) => {
    res.status(200).json({ nodeEnv: 'development' });
  });

  // ─── Loaded plugins (dynamic plugin provider) ──────────────────────

  let dynamicPlugins: BaseDynamicPlugin[] = [];
  try {
    const plugins = pluginProvider.plugins();
    dynamicPlugins = plugins.map(p => {
      if (p.platform === 'node') {
        const { installer, ...rest } = p;
        return rest as BaseDynamicPlugin;
      }
      return p as BaseDynamicPlugin;
    });
  } catch (e) {
    logger.warn(
      `Failed to retrieve dynamic plugins list: ${e}. /loaded-plugins will return empty.`,
    );
  }

  router.get('/loaded-plugins', async (req, response) => {
    await httpAuth.credentials(req, { allow: ['user', 'service'] });
    response.send(dynamicPlugins);
  });

  // ─── Pending changes (diff install file vs loaded) ─────────────────

  /**
   * Extract a comparable plugin name from an artifact reference.
   * Handles OCI (`oci://host/repo:tag!name`), local paths
   * (`./dynamic-plugins/dist/name`), and plain names.
   */
  const extractPluginName = (pkg: string): string => {
    // OCI format: oci://registry/repo:tag!package-name
    const ociIdx = pkg.indexOf('!');
    if (ociIdx !== -1) {
      return pkg.substring(ociIdx + 1);
    }
    // Local path: ./dynamic-plugins/dist/package-name
    const lastSlash = pkg.lastIndexOf('/');
    if (lastSlash !== -1) {
      return pkg.substring(lastSlash + 1);
    }
    return pkg;
  };

  // Track packages changed during THIS session (after startup).
  // Only these are truly "pending" — they haven't had a chance to load/unload yet.
  const changedThisSession = new Set<string>();

  /**
   * Builds a YAML string for a single package entry, optionally including
   * pluginConfig from the Package entity's appConfigExamples[0].content.
   *
   * Always returns a YAML map (not sequence), because
   * updatePackageConfig → validatePackageFormat expects isMap(contents).
   * Note: getPackageConfig() returns a YAML sequence (via toStringYaml),
   * so we extract the map item from it, not return it as-is.
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
    toBlockStyle(doc.contents);
    return doc.toString({ lineWidth: 120 });
  };

  router.get(
    '/pending-changes',
    requireInitializedInstallationDataService,
    async (req, response) => {
      await httpAuth.credentials(req, { allow: ['user', 'service'] });

      const loadedNames = new Set(dynamicPlugins.map(p => p.name));
      const installedPackages =
        await installationDataService.getAllInstalledPackages();

      const pendingInstalls: string[] = [];
      const pendingRemovals: string[] = [];

      for (const entry of installedPackages) {
        const name = extractPluginName(entry.package);
        if (!entry.disabled && !loadedNames.has(name)) {
          if (changedThisSession.has(entry.package)) {
            pendingInstalls.push(entry.package);
          }
          // Entries from previous sessions that didn't load are ignored
          // (not pending, not stale-removed — they stay in YAML for next restart)
        }
        if (entry.disabled && loadedNames.has(name)) {
          if (changedThisSession.has(entry.package)) {
            pendingRemovals.push(entry.package);
          }
          // Entries disabled before startup but still loaded (from defaults)
          // are ignored — can't unload without image change
        }
      }

      // Stale entries are NOT auto-removed. They represent installs from
      // previous sessions that either loaded successfully (and are fine)
      // or failed to load (user can investigate). Auto-removing was too
      // aggressive — it deleted legitimate installs after every restart
      // because changedThisSession resets on startup.

      response.json({
        count: pendingInstalls.length + pendingRemovals.length,
        pendingInstalls,
        pendingRemovals,
      });
    },
  );

  const middleware = MiddlewareFactory.create({ logger, config });
  router.use(middleware.error());

  return router;
}
