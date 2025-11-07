# Local Build

You can build the image locally by repeating the steps used to build the image in the CI/CD pipeline.

## Prepare Dynamic Plugins

Make sure your `yarn.lock` has all plugins pinned (`downloads` and `wrappers`) in `yarn.lock`:

```bash
cd dynamic-plugins
yarn clean
yarn cache clean # opcional
yarn turbo clean # opcional
yarn install
```

## Build Image Locally

```bash
docker buildx build . -t veecode/devportal:latest
```

## Optional: use NPM mirror

TODO
