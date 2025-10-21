# Dynamic Plugins

This module deals with the proper bundling of all preinstalled plugins.

## Build preinstalled plugins

All preinstalled plugins are defined in `dynamic-plugins/wrappers` and `dynamic-plugins/downloads` directories. Each wrapper is a construct that exports a dynamic plugin from a pre-existing static plugin (backend or frontend), working as a compatibility layer for older plugins. Newer plugins are already dynamic plugins by themselves, so there is no need to create wrappers for them, just add them to `dynamic-plugins/downloads/plugins.json` list.

If you want to build all preinstalled plugins, run:

```sh
cd dynamic-plugins/
yarn install
yarn build
yarn export-dynamic
yarn copy-dynamic-plugins $(pwd)/../dynamic-plugins-store
```
