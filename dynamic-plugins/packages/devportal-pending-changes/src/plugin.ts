import {
  createPlugin,
  createComponentExtension,
  createApiFactory,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';

import { pendingChangesApiRef, PendingChangesClient } from './api';

export const pendingChangesPlugin = createPlugin({
  id: 'pending-changes',
  apis: [
    createApiFactory({
      api: pendingChangesApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new PendingChangesClient({ discoveryApi, fetchApi }),
    }),
  ],
});

export const PendingChangesButton = pendingChangesPlugin.provide(
  createComponentExtension({
    name: 'PendingChangesButton',
    component: {
      lazy: () =>
        import('./components/PendingChangesButton/PendingChangesButton').then(
          m => m.PendingChangesButton,
        ),
    },
  }),
);
