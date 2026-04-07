import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import {
  ExtensionsPlugin,
  ExtensionsPluginInstallStatus,
} from '@red-hat-developer-hub/backstage-plugin-extensions-common';
import { dynamicPluginsInfoApiRef } from '../api';

export type MarketplaceStatus =
  | 'available'
  | 'built-in'
  | 'installed'
  | 'disabled'
  | 'pending-install'
  | 'pending-removal';

interface PendingChangesResponse {
  count: number;
  pendingInstalls: string[];
  pendingRemovals: string[];
}

export const usePluginStatus = (plugin: ExtensionsPlugin): MarketplaceStatus => {
  const dynamicPluginsInfoApi = useApi(dynamicPluginsInfoApiRef);
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const { data: loadedPlugins } = useQuery({
    queryKey: ['loaded-plugins'],
    queryFn: () => dynamicPluginsInfoApi.listLoadedPlugins(),
    staleTime: 30_000,
  });

  const { data: pendingChanges } = useQuery<PendingChangesResponse>({
    queryKey: ['pending-changes'],
    queryFn: async () => {
      const baseUrl = await discoveryApi.getBaseUrl('extensions');
      const res = await fetchApi.fetch(`${baseUrl}/pending-changes`);
      if (!res.ok) return { count: 0, pendingInstalls: [], pendingRemovals: [] };
      return res.json();
    },
    staleTime: 10_000,
  });

  return useMemo(() => {
    const installStatus = plugin.spec?.installStatus;
    const pluginName = plugin.metadata.name;

    const loadedNames = new Set(
      (loadedPlugins ?? []).map((p: { name: string }) => p.name),
    );

    // Check pending changes by scanning all pending lists for a name containing
    // the plugin's catalog name. This heuristic covers OCI and local paths.
    const hasPendingInstall = pendingChanges?.pendingInstalls?.some(
      pkg => extractName(pkg).includes(pluginName),
    ) ?? false;
    const hasPendingRemoval = pendingChanges?.pendingRemovals?.some(
      pkg => extractName(pkg).includes(pluginName),
    ) ?? false;

    if (hasPendingInstall) return 'pending-install';
    if (hasPendingRemoval) return 'pending-removal';

    // Check if loaded but not user-installed → built-in
    const isLoaded = loadedNames.size > 0 && Array.from(loadedNames).some(
      name => name.includes(pluginName),
    );
    const isInstalledByUser =
      installStatus === ExtensionsPluginInstallStatus.Installed ||
      installStatus === ExtensionsPluginInstallStatus.PartiallyInstalled ||
      installStatus === ExtensionsPluginInstallStatus.UpdateAvailable;

    if (isLoaded && !isInstalledByUser) return 'built-in';

    // Fall back to catalog install status
    if (installStatus === ExtensionsPluginInstallStatus.Disabled) return 'disabled';
    if (isInstalledByUser) return 'installed';

    return 'available';
  }, [plugin, loadedPlugins, pendingChanges]);
};

const extractName = (pkg: string): string => {
  const ociIdx = pkg.indexOf('!');
  if (ociIdx !== -1) return pkg.substring(ociIdx + 1);
  const lastSlash = pkg.lastIndexOf('/');
  if (lastSlash !== -1) return pkg.substring(lastSlash + 1);
  return pkg;
};
