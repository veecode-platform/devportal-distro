import {
  DiscoveryApi,
  FetchApi,
} from '@backstage/core-plugin-api';
import {
  PendingChangesApi,
  PendingChangesResponse,
} from './PendingChangesApi';

export class PendingChangesClient implements PendingChangesApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  async getPendingChanges(): Promise<PendingChangesResponse> {
    const baseUrl = await this.discoveryApi.getBaseUrl('extensions');
    const response = await this.fetchApi.fetch(
      `${baseUrl}/pending-changes`,
    );

    if (!response.ok) {
      return { count: 0, pendingInstalls: [], pendingRemovals: [] };
    }

    return response.json();
  }
}
