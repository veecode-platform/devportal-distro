import {
  PermissionCondition,
  PermissionCriteria,
  PermissionRuleParams,
} from '@backstage/plugin-permission-common';

import { ExtensionsPlugin } from '@red-hat-developer-hub/backstage-plugin-extensions-common';

import { rules as extensionRules } from '../permissions/rules';

export const matches = (
  plugin?: ExtensionsPlugin,
  filters?: PermissionCriteria<
    PermissionCondition<string, PermissionRuleParams>
  >,
): boolean => {
  if (!filters) {
    return true;
  }

  if (!plugin) {
    return false;
  }

  if ('allOf' in filters) {
    return filters.allOf.every(filter => matches(plugin, filter));
  }

  if ('anyOf' in filters) {
    return filters.anyOf.some(filter => matches(plugin, filter));
  }

  if ('not' in filters) {
    return !matches(plugin, filters.not);
  }
  return (
    Object.values(extensionRules)
      .find(r => r.name === filters.rule)
      ?.apply(plugin, filters.params as any) ?? false
  );
};
