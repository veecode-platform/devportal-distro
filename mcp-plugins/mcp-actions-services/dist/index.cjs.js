'use strict';

var alpha = require('@backstage/backend-defaults/alpha');
var backendPluginApi = require('@backstage/backend-plugin-api');

const mcpWellKnownModule = backendPluginApi.createBackendModule({
  pluginId: 'mcp-actions',
  moduleId: 'well-known',
  register(reg) {
    reg.registerInit({
      deps: {
        httpRouter: backendPluginApi.coreServices.httpRouter,
        config: backendPluginApi.coreServices.rootConfig,
      },
      async init({ httpRouter, config }) {
        httpRouter.addAuthPolicy({
          path: '/.well-known/mcp-config',
          allow: 'unauthenticated',
        });

        httpRouter.use('/.well-known/mcp-config', (_req, res) => {
          const baseUrl = config.getString('backend.baseUrl');
          const endpoint = `${baseUrl}/api/mcp-actions/v1`;
          res.status(200).json({
            endpoint,
            auth: {
              type: 'bearer',
              token_env_var: 'DEVPORTAL_MCP_TOKEN',
              note: 'Obtain the token value from your platform team.',
            },
            snippets: {
              claude_code: {
                description:
                  'Add to .mcp.json at project root, then: export DEVPORTAL_MCP_TOKEN=<token>',
                config: {
                  mcpServers: {
                    devportal: {
                      type: 'http',
                      url: endpoint,
                      headers: {
                        Authorization: 'Bearer ${DEVPORTAL_MCP_TOKEN}',
                      },
                    },
                  },
                },
              },
              codex_cli: {
                description:
                  'Add to ~/.codex/config.toml, then: export DEVPORTAL_MCP_TOKEN=<token>',
                config: `[mcp_servers.devportal]\nurl = "${endpoint}"\nbearer_token_env_var = "DEVPORTAL_MCP_TOKEN"`,
              },
            },
          });
        });
      },
    });
  },
});

// Use dynamicPluginInstaller interface for the dynamic plugin loader
// install() returns BackendFeature[] — the alpha service factories
exports.dynamicPluginInstaller = {
  kind: 'new',
  install: () => [
    alpha.actionsRegistryServiceFactory,
    alpha.actionsServiceFactory,
    mcpWellKnownModule,
  ],
};
