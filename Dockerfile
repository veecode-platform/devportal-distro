ARG TAG=1.1.20
FROM veecode/devportal-base:${TAG} AS base

# dynamic plugin processing
COPY --chown=default:default dynamic-plugins /app/dynamic-plugins

RUN mkdir -p /app/dynamic-plugins-store && \
    cd dynamic-plugins && \
    yarn install && \
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
