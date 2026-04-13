ARG TAG=1.3.1
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

# Limit turbo parallelism to reduce peak memory usage (avoids OOM on constrained hosts)
ENV TURBO_CONCURRENCY=2

RUN mkdir -p /app/dynamic-plugins-store && \
    cd /app/dynamic-plugins && \
    yarn install --immutable && \
    yarn workspace devportal-marketplace-backend run tsc && \
    yarn workspace devportal-marketplace-backend run build && \
    yarn workspace devportal-marketplace-backend-dynamic run tsc && \
    yarn workspace devportal-pending-changes run tsc && \
    yarn workspace devportal-pending-changes run build && \
    yarn workspace devportal-pending-changes-dynamic run tsc && \
    yarn workspace devportal-marketplace-frontend run tsc && \
    yarn workspace devportal-marketplace-frontend run build && \
    yarn workspace devportal-marketplace-frontend-dynamic run tsc && \
    yarn build && \
    yarn export-dynamic && \
    yarn copy-dynamic-plugins $(pwd)/../dynamic-plugins-store

FROM veecode/devportal-base:${TAG}

# Create the entrypoint script
COPY --chown=node:node --chmod=755 entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml", "--config", "/app/dynamic-plugins-root/app-config.dynamic-plugins.yaml"]

COPY --from=base --chown=default:default /app/dynamic-plugins-store /app/dynamic-plugins/dist

# ── Pre-install dynamic plugins into dynamic-plugins-root/ ────────────
# Copies local plugins from the build stage and downloads OCI plugins at
# build time. Matching entries in dynamic-plugins.default.yaml carry
# preInstalled: true so the install script skips installation at startup.

# 4 local plugins (already built in the base stage)
RUN cp -a /app/dynamic-plugins/dist/veecode-platform-backstage-plugin-about-backend-dynamic  /app/dynamic-plugins-root/ && \
    cp -a /app/dynamic-plugins/dist/veecode-platform-backstage-plugin-about-dynamic           /app/dynamic-plugins-root/ && \
    cp -a /app/dynamic-plugins/dist/devportal-marketplace-backend-dynamic-dynamic              /app/dynamic-plugins-root/ && \
    cp -a /app/dynamic-plugins/dist/devportal-pending-changes-dynamic                          /app/dynamic-plugins-root/ && \
    cp -a /app/dynamic-plugins/dist/devportal-marketplace-frontend-dynamic              /app/dynamic-plugins-root/

# 2 OCI plugins from quay.io/veecode/extensions
ARG EXTENSIONS_TAG=bs_1.49.4
RUN set -e && \
    OCI_IMAGE="docker://quay.io/veecode/extensions:$EXTENSIONS_TAG" && \
    TMP_OCI="$(mktemp -d)" && \
    skopeo copy "$OCI_IMAGE" "dir:$TMP_OCI" && \
    LAYER=$(jq -r '.layers[0].digest' "$TMP_OCI/manifest.json" | sed 's/sha256://') && \
    TMP_EXTRACT="$(mktemp -d)" && \
    tar -xzf "$TMP_OCI/$LAYER" -C "$TMP_EXTRACT" && \
    cp -a "$TMP_EXTRACT/red-hat-developer-hub-backstage-plugin-extensions"                        /app/dynamic-plugins-root/ && \
    cp -a "$TMP_EXTRACT/red-hat-developer-hub-backstage-plugin-catalog-backend-module-extensions"  /app/dynamic-plugins-root/ && \
    rm -rf "$TMP_OCI" "$TMP_EXTRACT"

# Generate devportal.json with version info (consumed by about plugin)
ARG DEVPORTAL_VERSION=dev
RUN echo "{\"version\":\"${DEVPORTAL_VERSION}\"}" > /app/devportal.json
COPY --chown=default:default dynamic-plugins.yaml /app/dynamic-plugins.yaml
COPY --chown=default:default dynamic-plugins.default.yaml /app/dynamic-plugins.default.yaml
COPY --chown=default:default docker/install-dynamic-plugins.py /app/install-dynamic-plugins.py
COPY --chown=default:default --chmod=755 docker/install-dynamic-plugins.sh /app/install-dynamic-plugins.sh
# override profile config files - these will take precedence over the base image ones
COPY --chown=default:default profiles/*.yaml /app/
# Marketplace catalog entities — baked-in fallback.
# In CI, the build job should populate catalog-entities/ from the OCI catalog
# index (or sparse checkout from export-overlays) BEFORE building the image.
# At runtime, entrypoint.sh will try to refresh from OCI; if that fails,
# this baked-in copy ensures the marketplace is never completely empty.
COPY --chown=default:default catalog-entities /app/catalog-entities
RUN mkdir -p /app/catalog-entities/extensions/plugins \
            /app/catalog-entities/extensions/packages \
            /app/catalog-entities/extensions/collections

# Append distro-specific RBAC policies (extensions marketplace) to the base image's CSV
COPY rbac-policy-extensions.csv /tmp/rbac-policy-extensions.csv
RUN cat /tmp/rbac-policy-extensions.csv >> /app/rbac-policy.csv

# Distro-specific config overrides (loaded by entrypoint between production and local configs)
COPY --chown=default:default app-config.distro.yaml /app/app-config.distro.yaml

