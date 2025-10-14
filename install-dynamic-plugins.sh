#!/bin/bash
set -e

CONFIG_FILE="${1:-/opt/app-root/src/dynamic-plugins.yaml}"
DYNAMIC_PLUGINS_ROOT="${DYNAMIC_PLUGINS_ROOT:-/opt/app-root/src/dynamic-plugins-root}"

echo "Installing dynamic plugins from: ${CONFIG_FILE}"

# Convert CONFIG_FILE to absolute path if it's relative
if [[ "${CONFIG_FILE}" != /* ]]; then
    CONFIG_DIR="$(dirname "${CONFIG_FILE}")"
    CONFIG_BASE="$(basename "${CONFIG_FILE}")"
    if [ -d "${CONFIG_DIR}" ]; then
        CONFIG_FILE="$(cd "${CONFIG_DIR}" && pwd)/${CONFIG_BASE}"
    else
        echo "Error: Directory ${CONFIG_DIR} does not exist"
        exit 1
    fi
fi

# Create the dynamic plugins directory if it doesn't exist
mkdir -p "${DYNAMIC_PLUGINS_ROOT}"

# Check if yq is available, if not use a simple parser
if ! command -v yq &> /dev/null; then
    echo "yq not found, installing..."
    # Download yq for parsing YAML
    wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64"
    chmod +x /usr/local/bin/yq
fi

# Check if the config file exists and has plugins defined
if [ ! -f "${CONFIG_FILE}" ]; then
    echo "No dynamic plugins configuration file found at ${CONFIG_FILE}"
    exit 0
fi

# Count the number of plugins
PLUGIN_COUNT=$(yq eval '.plugins | length' "${CONFIG_FILE}")

if [ "${PLUGIN_COUNT}" == "0" ] || [ "${PLUGIN_COUNT}" == "null" ]; then
    echo "No plugins configured in ${CONFIG_FILE}"
    exit 0
fi

echo "Found ${PLUGIN_COUNT} plugin(s) to install"

# Initialize npm in the dynamic plugins directory
cd "${DYNAMIC_PLUGINS_ROOT}"
if [ ! -f "package.json" ]; then
    npm init -y
fi

# Read and install each plugin
for i in $(seq 0 $((PLUGIN_COUNT - 1))); do
    PACKAGE=$(yq eval ".plugins[${i}].package" "${CONFIG_FILE}")
    VERSION=$(yq eval ".plugins[${i}].version" "${CONFIG_FILE}")
    DISABLED=$(yq eval ".plugins[${i}].disabled" "${CONFIG_FILE}")
    
    # Skip if package is null or disabled
    if [ "${PACKAGE}" == "null" ] || [ "${DISABLED}" == "true" ]; then
        continue
    fi
    
    # Construct the package spec
    if [ "${VERSION}" != "null" ]; then
        PACKAGE_SPEC="${PACKAGE}@${VERSION}"
    else
        PACKAGE_SPEC="${PACKAGE}"
    fi
    
    echo "Installing plugin: ${PACKAGE_SPEC}"
    npm install --omit=dev "${PACKAGE_SPEC}"
done

echo "Dynamic plugins installation complete"

# List installed plugins
echo "Installed plugins:"
npm list --depth=0
