/*
 * Copyright The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useQuery } from '@tanstack/react-query';

import { useExtensionsApi } from './useExtensionsApi';
import { PluginPermissions, Permission } from '../types';

const defaultPermissions: PluginPermissions = { read: Permission.DENY, write: Permission.DENY };

export const usePluginConfigurationPermissions = (
  namespace: string,
  name: string,
) => {
  const extensionsApi = useExtensionsApi();

  return useQuery<PluginPermissions, Error>({
    queryKey: [
      'extensionsApi',
      'getPluginConfigAuthorization',
      namespace,
      name,
    ],
    queryFn: async (): Promise<PluginPermissions> => {
      if (namespace && name && extensionsApi.getPluginConfigAuthorization) {
        return extensionsApi.getPluginConfigAuthorization(namespace, name) as Promise<PluginPermissions>;
      }
      return defaultPermissions;
    },
  });
};
