# devportal-distro
VeeCode DevPortal - a Full Backstage Distro

## Overview

This project creates a derived Docker image from [veecode/devportal-base](https://github.com/veecode-platform/devportal-base) by allowing the addition of dynamic plugins into a new image. The plugins are pre-built and will be downloaded from the NPM registry during build time.

The base image already provides the mechanics for loading plugins dynamically. This repository adds a layer that allows you to specify which plugins to include via a configuration file.

## Features

- ✨ Declarative plugin configuration via YAML
- 📦 Automatic plugin installation from NPM registry during build
- 🔄 Version pinning support for reproducible builds
- 🚀 Built on top of the official VeeCode DevPortal base image

## Quick Start

### 1. Configure Your Plugins

Edit the `dynamic-plugins.yaml` file to specify which plugins you want to include:

```yaml
plugins:
  - package: '@backstage/plugin-catalog-backend-module-github'
    version: '^0.5.0'
  
  - package: '@backstage/plugin-kubernetes-backend'
    version: '^0.18.0'
  
  - package: '@roadiehq/backstage-plugin-argo-cd-backend'
    version: '^2.14.0'
```

### 2. Build the Docker Image

Build your customized DevPortal image:

```bash
docker build -t my-devportal:latest .
```

You can specify a different base image tag:

```bash
docker build --build-arg TAG=v1.2.3 -t my-devportal:v1.2.3 .
```

### 3. Run the Container

```bash
docker run -p 7007:7007 my-devportal:latest
```

## Configuration

### Dynamic Plugins Configuration

The `dynamic-plugins.yaml` file supports the following structure:

```yaml
plugins:
  - package: '<npm-package-name>'
    version: '<version-spec>'     # Optional, defaults to 'latest'
    disabled: false                # Optional, defaults to false
```

#### Configuration Options

- **package** (required): The NPM package name of the plugin
- **version** (optional): The version or version range to install. Supports NPM semver syntax (e.g., `^1.0.0`, `~2.1.0`, `latest`)
- **disabled** (optional): Set to `true` to skip installing this plugin

#### Example Configuration

```yaml
plugins:
  # Install specific version
  - package: '@backstage/plugin-catalog-backend-module-github'
    version: '0.5.0'
  
  # Install with version range
  - package: '@backstage/plugin-kubernetes-backend'
    version: '^0.18.0'
  
  # Install latest version
  - package: '@roadiehq/backstage-plugin-argo-cd-backend'
  
  # Temporarily disable a plugin
  - package: '@janus-idp/backstage-plugin-topology'
    version: '1.0.0'
    disabled: true
```

## Build Arguments

- **TAG**: The tag of the base image to use (default: `latest`)

Example:
```bash
docker build --build-arg TAG=v1.0.0 -t my-devportal:v1.0.0 .
```

## Environment Variables

The installation script respects the following environment variables:

- **DYNAMIC_PLUGINS_ROOT**: Directory where plugins are installed (default: `/opt/app-root/src/dynamic-plugins-root`)

## Plugin Discovery

The base image (`veecode/devportal-base`) automatically discovers and loads plugins from the `DYNAMIC_PLUGINS_ROOT` directory. No additional configuration is needed beyond adding plugins to `dynamic-plugins.yaml`.

## Development

### Testing Your Configuration

To test your plugin configuration without building the full image:

```bash
# Install yq for YAML parsing
wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64"
chmod +x /usr/local/bin/yq

# Run the installation script locally
./install-dynamic-plugins.sh
```

### Adding Custom Plugins

If you have custom or private plugins:

1. Ensure they are published to a registry accessible during build
2. Configure NPM authentication if needed (in Dockerfile)
3. Add the plugin to `dynamic-plugins.yaml`

## Troubleshooting

### Build Fails During Plugin Installation

- Verify the plugin package name is correct
- Check that the specified version exists on NPM
- Ensure your network can access the NPM registry

### Plugin Not Loading at Runtime

- Verify the plugin was installed (check build logs)
- Ensure the base image version supports your plugins
- Check that the plugin is not marked as `disabled: true`

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Related Projects

- [veecode-platform/devportal-base](https://github.com/veecode-platform/devportal-base) - Base DevPortal image
- [Backstage](https://backstage.io/) - The platform DevPortal is built on
