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
    removeVerboseSpecContent(plugins);
    res.json(plugins);
  });

  // ─── Package routes ─────────────────────────────────────────────────

  router.get('/packages', async (req, res) => {
    const request = decodeGetEntitiesRequest(createSearchParams(req));
    const packages = await extensionsApi.getPackages(request);
    removeVerboseSpecContent(packages.items);
    res.json(packages);
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
      const result = installationDataService.getPackageConfig(
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
        installationDataService.updatePackageConfig(
          extensionsPackage.spec.dynamicArtifact,
          newConfig,
        );
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
      installationDataService.setPackageDisabled(
        extensionsPackage.spec.dynamicArtifact,
        disabled,
      );
      res.status(200).json({ status: 'OK' });
    },
  );

  // ─── Plugin routes ──────────────────────────────────────────────────

  router.get('/plugins', async (req, res) => {
    const request = decodeGetEntitiesRequest(createSearchParams(req));
    const plugins = await extensionsApi.getPlugins(request);
    removeVerboseSpecContent(plugins.items);
    res.json(plugins);
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
      let plugin: ExtensionsPlugin;

      const evaluateConditional = async (
        decision: PolicyDecision,
        action: string,
      ) => {
        if (decision.result === AuthorizeResult.CONDITIONAL) {
          if (!plugin) {
            plugin = await extensionsApi.getPluginByName(
              req.params.namespace,
              req.params.name,
            );
          }
          if (matches(plugin, decision.conditions)) {
            authorizedActions = { ...authorizedActions, [action]: 'ALLOW' };
          }
        } else if (decision.result === AuthorizeResult.ALLOW) {
          authorizedActions = { ...authorizedActions, [action]: 'ALLOW' };
        }
      };

      await Promise.all([
        evaluateConditional(readDecision, 'read'),
        evaluateConditional(installDecision, 'write'),
      ]);

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
      try {
        await installationDataService.updatePluginConfig(plugin, newConfig);
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
      await installationDataService.setPluginDisabled(plugin, disabled);
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
  // TODO: Replace with Opção A (custom `installEnabled` flag) when the
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

  router.get(
    '/pending-changes',
    requireInitializedInstallationDataService,
    async (req, response) => {
      await httpAuth.credentials(req, { allow: ['user', 'service'] });

      const loadedNames = new Set(dynamicPlugins.map(p => p.name));
      const installedPackages =
        installationDataService.getAllInstalledPackages();

      const pendingInstalls: string[] = [];
      const pendingRemovals: string[] = [];

      for (const entry of installedPackages) {
        const name = extractPluginName(entry.package);
        if (!entry.disabled && !loadedNames.has(name)) {
          pendingInstalls.push(entry.package);
        }
        if (entry.disabled && loadedNames.has(name)) {
          pendingRemovals.push(entry.package);
        }
      }

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
