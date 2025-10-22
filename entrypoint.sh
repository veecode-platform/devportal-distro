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

# ENTRYPOINT INSTALL PLUGINS
/app/install-dynamic-plugins.sh /app/dynamic-plugins-root

DYNAMIC_PLUGINS_CONFIG="/app/dynamic-plugins-root/app-config.dynamic-plugins.yaml"
LOCAL_CONFIG="/app/app-config.local.yaml"
EXTRA_ARGS=""
if [ -f "$LOCAL_CONFIG" ]; then
    EXTRA_ARGS="--config $LOCAL_CONFIG"
fi
if [ -f "$DYNAMIC_PLUGINS_CONFIG" ]; then
    EXTRA_ARGS="$EXTRA_ARGS --config $DYNAMIC_PLUGINS_CONFIG"
fi

# EXECUTE THE COMMAND
if [ "$DEVELOPMENT" = "true" ]; then
    echo "Running in DEVELOPMENT mode with auto-restart on config changes"
    exec npx nodemon \
        --watch app-config.yaml \
        --watch app-config.production.yaml \
        --watch app-config.dynamic-plugins.yaml \
        --watch "$LOCAL_CONFIG" \
        --watch "$DYNAMIC_PLUGINS_CONFIG" \
        --exec "node packages/backend --config app-config.yaml --config app-config.production.yaml --config app-config.dynamic-plugins.yaml $EXTRA_ARGS"
else
    exec node packages/backend \
        --config app-config.yaml \
        --config app-config.production.yaml \
        --config app-config.dynamic-plugins.yaml \
        $EXTRA_ARGS
fi
