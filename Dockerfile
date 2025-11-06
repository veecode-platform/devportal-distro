ARG TAG=1.1.39
FROM veecode/devportal-base:${TAG} AS base

# allows setting NPM registry from build arg
ARG NPM_REGISTRY=https://registry.npmjs.org/
# Set as environment variable (so npm install uses it)
ENV NPM_REGISTRY=$NPM_REGISTRY NPM_CONFIG_REGISTRY=$NPM_REGISTRY YARN_REGISTRY=$NPM_REGISTRY
# Strict, reproducible install (no node_modules from host)
RUN echo "Using NPM Registry: $NPM_REGISTRY" && \
    if [ "$NPM_REGISTRY" != "https://registry.npmjs.org/" ]; then \
      HOST=$(printf '%s\n' "$NPM_REGISTRY" | awk -F[/:] '{print $4}') && \
      yarn config set unsafeHttpWhitelist --json "[\"localhost\",\"$HOST\"]"; \
    fi && \
    yarn config set nodeLinker node-modules && \
    yarn config set npmRegistryServer "$NPM_REGISTRY" && \
    cp .yarnrc.yml $HOME/.yarnrc.yml

# dynamic plugin processing
COPY --chown=default:default dynamic-plugins /app/dynamic-plugins

RUN mkdir -p /app/dynamic-plugins-store && \
    cd /app/dynamic-plugins && \
    yarn install --immutable && \
    yarn build && \
    yarn export-dynamic && \
    yarn copy-dynamic-plugins $(pwd)/../dynamic-plugins-store

FROM veecode/devportal-base:${TAG}

# Create the entrypoint script
COPY --chown=node:node --chmod=755 entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml", "--config", "app-config.dynamic-plugins.yaml", "--config", "/app/dynamic-plugins-root/app-config.dynamic-plugins.yaml"]

COPY --from=base --chown=default:default /app/dynamic-plugins-store /app/dynamic-plugins/dist
COPY --chown=default:default dynamic-plugins.yaml /app/dynamic-plugins.yaml
COPY --chown=default:default dynamic-plugins.default.yaml /app/dynamic-plugins.default.yaml
COPY --chown=default:default docker/install-dynamic-plugins.py /app/install-dynamic-plugins.py
COPY --chown=default:default --chmod=755 docker/install-dynamic-plugins.sh /app/install-dynamic-plugins.sh
