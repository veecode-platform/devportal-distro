import { createApiRef } from '@backstage/core-plugin-api';

export interface PendingChangesResponse {
  count: number;
  pendingInstalls: string[];
  pendingRemovals: string[];
}

export interface PendingChangesApi {
  getPendingChanges(): Promise<PendingChangesResponse>;
}

export const pendingChangesApiRef = createApiRef<PendingChangesApi>({
  id: 'plugin.pending-changes',
});
