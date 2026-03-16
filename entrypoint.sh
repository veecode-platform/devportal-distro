#!/bin/bash

# ENTRYPOINT THEME HACKING

# old chart, will remove
if [ -n "$PLATFORM_DEVPORTAL_THEME_URL" ]; then
    echo "Getting custom theme file from $PLATFORM_DEVPORTAL_THEME_URL"
    curl -L -o /app/packages/app/dist/theme.json "$PLATFORM_DEVPORTAL_THEME_URL"
fi
# old chart, will remove
if [ -n "$PLATFORM_DEVPORTAL_FAVICON" ]; then
    echo "Getting favicon.ico from $PLATFORM_DEVPORTAL_FAVICON"
    curl -L -o /app/packages/app/dist/favicon.ico "$PLATFORM_DEVPORTAL_FAVICON"
fi

# new "next" chart
if [ -n "$THEME_DOWNLOAD_URL" ]; then
    echo "Getting custom theme file from $THEME_DOWNLOAD_URL"
    curl -L -o /app/packages/app/dist/theme.json "$THEME_DOWNLOAD_URL"
elif [ -n "$THEME_CUSTOM_JSON" ]; then
    if [ "false" = "$THEME_MERGE_JSON" ]; then
        echo "Using custom theme JSON from THEME_CUSTOM_JSON"
        echo "$THEME_CUSTOM_JSON" > /app/packages/app/dist/dist/theme.json
    else
        echo "Merging custom theme JSON from THEME_CUSTOM_JSON"
        TARGET_JSON="/app/packages/app/dist/theme.json"
        TMP_JSON="$(mktemp)"
        MERGED_JSON="$(mktemp)"
        echo "$THEME_CUSTOM_JSON" > "$TMP_JSON"
        # Merge env-provided JSON with the existing JSON, output as JSON
        yq -p=json -o=json eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' \
            "$TARGET_JSON" "$TMP_JSON" > "$MERGED_JSON"
        mv "$MERGED_JSON" "$TARGET_JSON"
        rm "$TMP_JSON"
    fi
fi
# new "next" chart
if [ -n "$THEME_FAV_ICON" ]; then
    echo "Getting favicon.ico from $THEME_FAV_ICON"
    curl -L -o /app/packages/app/dist/favicon.ico "$THEME_FAV_ICON"
fi

# ENTRYPOINT DOWNLOAD CATALOG INDEX
# Downloads the marketplace catalog entities (Plugin/Package/Collection YAMLs)
# from the OCI catalog index image published by export-overlays.
CATALOG_INDEX_IMAGE="${CATALOG_INDEX_IMAGE:-quay.io/veecode/plugin-catalog-index:latest}"
CATALOG_DIR="/app/catalog-entities/extensions"
if [ ! -d "$CATALOG_DIR/plugins" ] || [ "${CATALOG_INDEX_REFRESH:-false}" = "true" ]; then
    echo "Downloading catalog index from $CATALOG_INDEX_IMAGE"
    TMP_CATALOG="$(mktemp -d)"
    if skopeo copy "docker://$CATALOG_INDEX_IMAGE" "dir:$TMP_CATALOG"; then
        # Extract the single layer (tar) into the catalog directory
        mkdir -p "$CATALOG_DIR"
        LAYER=$(jq -r '.layers[0].digest' "$TMP_CATALOG/manifest.json" | sed 's/sha256://')
        tar -xf "$TMP_CATALOG/$LAYER" -C "$CATALOG_DIR" --strip-components=1 2>/dev/null || \
        tar -xzf "$TMP_CATALOG/$LAYER" -C "$CATALOG_DIR" --strip-components=1 2>/dev/null || \
        { echo "ERROR: Failed to extract catalog index layer"; }
        # Validate extraction
        YAML_COUNT=$(find "$CATALOG_DIR" -name '*.yaml' 2>/dev/null | wc -l)
        if [ "$YAML_COUNT" -lt 50 ]; then
            echo "WARNING: Catalog index has only $YAML_COUNT YAML files (expected ~215). Marketplace may be incomplete."
        else
            echo "Catalog index loaded: $YAML_COUNT YAML files"
        fi
    else
        echo "WARNING: Failed to download catalog index from $CATALOG_INDEX_IMAGE"
        echo "Marketplace will use any pre-existing catalog entities (baked-in or from previous run)."
    fi
    rm -rf "$TMP_CATALOG"
else
    echo "Catalog entities already present, skipping download (set CATALOG_INDEX_REFRESH=true to force)"
fi

# ENTRYPOINT INSTALL PLUGINS
/app/install-dynamic-plugins.sh /app/dynamic-plugins-root

# Remove RHDH extensions backend AFTER install — it ships in the base image
# and gets re-installed by install-dynamic-plugins.sh from defaults.
# Our devportal-marketplace-backend replaces it (same pluginId "extensions").
rm -rf /app/dynamic-plugins-root/red-hat-developer-hub-backstage-plugin-extensions-backend 2>/dev/null

# SAAS: expands VEECODE_APP_CONFIG and VEECODE_DYNAMIC_PLUGINS into files
if [ ! -z "$VEECODE_APP_CONFIG" ]; then
    echo "VEECODE_APP_CONFIG detected (this is expected in VeeCode SaaS deployments), decoding into /app/app-config.local.yaml"
    echo "$VEECODE_APP_CONFIG" | base64 -d > /app/app-config.local.yaml
    echo "VEECODE_APP_CONFIG expanded into /app/app-config.local.yaml successfully"
else
    echo "VEECODE_APP_CONFIG variable not found (this is expected in non-SaaS deployments)"
fi
# Decode VEECODE_DYNAMIC_PLUGINS and convert to YAML
if [ ! -z "$VEECODE_DYNAMIC_PLUGINS" ]; then
    echo "VEECODE_DYNAMIC_PLUGINS detected (this is expected in VeeCode SaaS deployments), decoding into /app/dynamic-plugins.yaml"
    echo "$VEECODE_DYNAMIC_PLUGINS" | base64 -d > /app/dynamic-plugins.yaml
    echo "VEECODE_DYNAMIC_PLUGINS expanded into /app/dynamic-plugins.yaml successfully"
else
    echo "VEECODE_DYNAMIC_PLUGINS variable not found (this is expected in non-SaaS deployments)"
fi
if [ ! -z "$VEECODE_DOMAIN" ]; then
    echo "VEECODE_DOMAIN detected (this is expected in VeeCode SaaS deployments): $VEECODE_DOMAIN"
else
    echo "VEECODE_DOMAIN variable not found (this is expected in non-SaaS deployments)"
fi

DYNAMIC_PLUGINS_CONFIG="/app/dynamic-plugins-root/app-config.dynamic-plugins.yaml"
LOCAL_CONFIG="/app/app-config.local.yaml"
EXTRA_ARGS=""
if [ -f "$LOCAL_CONFIG" ]; then
    EXTRA_ARGS="--config $LOCAL_CONFIG"
fi
if [ -f "$DYNAMIC_PLUGINS_CONFIG" ]; then
    EXTRA_ARGS="$EXTRA_ARGS --config $DYNAMIC_PLUGINS_CONFIG"
fi

# Conditionally add app-config.PROFILE.yaml
case "$VEECODE_PROFILE" in
  github-pat)
    echo "VEECODE: Loading GitHub PAT configuration. Required env vars: GITHUB_TOKEN, GITHUB_ORG"
    EXTRA_ARGS="$EXTRA_ARGS --config app-config.github-pat.yaml"
    ;;
  github)
    echo "VEECODE: Loading GitHub configuration..."
    # if GITHUB_AUTH_CLIENT_ID is not set, set it to GITHUB_CLIENT_ID
    # if GITHUB_AUTH_CLIENT_SECRET is not set, set it to GITHUB_CLIENT_SECRET
    if [ -z "$GITHUB_AUTH_CLIENT_ID" ]; then
      export GITHUB_AUTH_CLIENT_ID=$GITHUB_CLIENT_ID
    fi
    if [ -z "$GITHUB_AUTH_CLIENT_SECRET" ]; then
      export GITHUB_AUTH_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
    fi
    # if GITHUB_PRIVATE_KEY_BASE64 is set, decode it and set GITHUB_PRIVATE_KEY
    if [ -n "$GITHUB_PRIVATE_KEY_BASE64" ]; then
        export GITHUB_PRIVATE_KEY=$(echo "$GITHUB_PRIVATE_KEY_BASE64" | base64 --decode)
    fi
    EXTRA_ARGS="$EXTRA_ARGS --config app-config.github.yaml"
    ;;
  gitlab)
    echo "VEECODE: Loading GitLab configuration..."
    EXTRA_ARGS="$EXTRA_ARGS --config app-config.gitlab.yaml"
    ;;
  keycloak)
    echo "VEECODE: Loading Keycloak configuration..."
    if [ -z "$KEYCLOAK_METADATA_URL" ]; then
      export KEYCLOAK_METADATA_URL="$KEYCLOAK_BASE_URL/realms/$KEYCLOAK_REALM"
    fi
    echo "VEECODE: Keycloak metadata URL: $KEYCLOAK_METADATA_URL"
    EXTRA_ARGS="$EXTRA_ARGS --config app-config.keycloak.yaml"
    ;;
  azure)
    echo "VEECODE: Loading Azure configuration..."
    EXTRA_ARGS="$EXTRA_ARGS --config app-config.azure.yaml"
    ;;
  ldap)
    echo "VEECODE: Loading LDAP configuration..."
    EXTRA_ARGS="$EXTRA_ARGS --config app-config.ldap.yaml"
    ;;
esac

#
# understand config files precedence (all merge, override in order)
#
# app-config.yaml
# app-config.production.yaml
# app-config.dynamic-plugins.yaml
# app-config.local.yaml
# dynamic-plugins-root/app-config.dynamic-plugins.yaml
# app-config.{profile}.yaml (if VEECODE_PROFILE is set)
#

if [ -z "$DEBUG_PORT" ]; then
    DEBUG_ARGS=""
else
    DEBUG_ARGS="--inspect=0.0.0.0:$DEBUG_PORT"
fi

# EXECUTE THE COMMAND
if [ "$DEVELOPMENT" = "true" ]; then
    echo "Running in DEVELOPMENT mode with auto-restart on config changes and debug port"
    echo "EXTRA_ARGS=$EXTRA_ARGS"
    exec npx nodemon \
        --watch app-config.yaml \
        --watch app-config.production.yaml \
        --watch app-config.dynamic-plugins.yaml \
        --watch "$LOCAL_CONFIG" \
        --watch "$DYNAMIC_PLUGINS_CONFIG" \
        --exec "node $NODE_OPTIONS $DEBUG_ARGS packages/backend --config app-config.yaml --config app-config.production.yaml --config app-config.dynamic-plugins.yaml $EXTRA_ARGS"
else
    echo "Running in PRODUCTION mode"
    echo "EXTRA_ARGS=$EXTRA_ARGS"
    exec node $NODE_OPTIONS $DEBUG_ARGS packages/backend \
        --config app-config.yaml \
        --config app-config.production.yaml \
        --config app-config.dynamic-plugins.yaml $EXTRA_ARGS
fi
