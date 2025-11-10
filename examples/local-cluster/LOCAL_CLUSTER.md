# Kubernetes Plugin (Local Cluster)

While the kubernetes backend plugin is statically loaded (bundled in the base image), the kubernetes frontend plugin can be loaded dynamically (defined in this image as a pre-installed plugin).

The desired kubernetes clusters configuration is somewhat subjective:

- You may want to deal with a fixed cluster list, hard coded in the `app-config.yaml` file.
- You may want to deal with a fixed (but a little more flexible) cluster list, hard coded in the dynamic configuration (`dynamic-plugins.yaml`) file.
- You may want to deal with a dynamic cluster list, defined as catalog items.

## Testing locally

As a quick way to test the kubernetes plugin, you can use the `vkdr` tool to start a local cluster and configure the DevPortal to use a `localKubectlProxy` connection to it (no need for cluster authentication).

1. Start a local cluster with `vkdr` (or just use `k3d`, `minikube`, etc.):

   ```bash
   vkdr infra up
   ```

2. Deploy a labeled service in the cluster (e.g. Kong):

   ```bash
   vkdr kong install --default-ic -t 3.9.1 --label "vee.codes/cluster=local"
   ```

3. Run `kubectl proxy` to expose the cluster API to the DevPortal container:

   ```sh
   kubectl proxy -p 8100
   ```

4. Set env vars used in `docker-compose.yml`:

   ```sh
   export VEECODE_PROFILE=github
   ```

5. Start the DevPortal:

   ```sh
   docker compose up --no-log-prefix
   ```

Note: there is an auxiliary container `kubectl-proxy` that exposes the proxy to the cluster API into the DevPortal container. This (unsafe) hack is necessary because `localKubectlProxy` only works with localhost.

This is somewhat cumbersome, but will avoid the need to deal with service account authentication.
