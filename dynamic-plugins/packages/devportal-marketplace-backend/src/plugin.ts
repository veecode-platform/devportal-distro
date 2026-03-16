import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { dynamicPluginsServiceRef } from '@backstage/backend-dynamic-feature-service';

import {
  ExtensionsApi,
  ExtensionsCatalogClient,
} from '@red-hat-developer-hub/backstage-plugin-extensions-common';

import { createRouter } from './router';
import { InstallationDataService } from './installation/InstallationDataService';

/**
 * DevPortal Extensions backend plugin.
 *
 * Drop-in replacement for the RHDH extensions-backend that removes the
 * production-mode block, allowing install/enable/disable at any NODE_ENV.
 *
 * @public
 */
export const extensionsPlugin = createBackendPlugin({
  pluginId: 'extensions',
  register(env) {
    env.registerInit({
      deps: {
        auth: coreServices.auth,
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        discovery: coreServices.discovery,
        logger: coreServices.logger,
        permissions: coreServices.permissions,
        pluginProvider: dynamicPluginsServiceRef,
      },
      async init({
        pluginProvider,
        auth,
        config,
        httpAuth,
        httpRouter,
        discovery,
        logger,
        permissions,
      }) {
        const catalogApi = new CatalogClient({ discoveryApi: discovery });

        const extensionsApi: ExtensionsApi = new ExtensionsCatalogClient({
          auth,
          catalogApi,
        });

        const installationDataService: InstallationDataService =
          InstallationDataService.fromConfig({
            config,
            extensionsApi,
            logger,
          });

        httpRouter.use(
          await createRouter({
            httpAuth,
            installationDataService,
            extensionsApi,
            permissions,
            pluginProvider,
            logger,
            config,
          }),
        );
      },
    });
  },
});
