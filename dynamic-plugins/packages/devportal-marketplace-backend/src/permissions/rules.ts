import {
  createPermissionResourceRef,
  createPermissionRule,
  type PermissionRule,
} from '@backstage/plugin-permission-node';
import { z } from 'zod';
import {
  ExtensionsPlugin,
  RESOURCE_TYPE_EXTENSIONS_PLUGIN,
} from '@red-hat-developer-hub/backstage-plugin-extensions-common';

export type ExtentionFilter = {
  key: string;
  values: Array<string> | undefined;
};

export type ExtentionFilters =
  | { anyOf: ExtentionFilters[] }
  | { allOf: ExtentionFilters[] }
  | { not: ExtentionFilters }
  | ExtentionFilter;

export const extensionsPermissionResourceRef = createPermissionResourceRef<
  ExtensionsPlugin,
  ExtentionFilter
>().with({
  pluginId: 'extensions',
  resourceType: RESOURCE_TYPE_EXTENSIONS_PLUGIN,
});

export type ExtensionParams = {
  annotation: string;
  value?: string;
  pluginNames?: string[];
};

const hasPluginName = createPermissionRule({
  name: 'HAS_NAME' as const,
  description: 'Should allow users to install the plugin with specified name',
  resourceRef: extensionsPermissionResourceRef,
  paramsSchema: z.object({
    pluginNames: z
      .string()
      .array()
      .optional()
      .describe('List of plugin names or titles to match on'),
  }) as any,
  apply: (plugin: any, params: any) => {
    const { pluginNames } = params ?? {};
    return pluginNames && pluginNames.length > 0
      ? pluginNames.some(
          (name: string) =>
            name.toLowerCase() === plugin.metadata.title?.toLowerCase() ||
            name.toLowerCase() === plugin.metadata.name.toLowerCase(),
        )
      : true;
  },
  toQuery: (params: any) => ({
    key: 'name',
    values: params?.pluginNames,
  }),
}) as PermissionRule<ExtensionsPlugin, ExtentionFilter, 'extensions-plugin', ExtensionParams>;

const hasAnnotation = createPermissionRule({
  name: 'HAS_ANNOTATION' as const,
  description:
    'Should allow users to install the plugin with specified annotation',
  resourceRef: extensionsPermissionResourceRef,
  paramsSchema: z.object({
    annotation: z.string().describe('Name of the annotation to match on'),
    value: z
      .string()
      .optional()
      .describe('Value of the annotation to match on'),
  }) as any,
  apply: (plugin: any, params: any) =>
    !!plugin.metadata.annotations?.hasOwnProperty(params.annotation) &&
    (params.value === undefined
      ? true
      : plugin.metadata.annotations?.[params.annotation] === params.value),
  toQuery: (params: any) => ({
    key: params.annotation,
    values: params.value ? [params.value] : undefined,
  }),
}) as PermissionRule<ExtensionsPlugin, ExtentionFilter, 'extensions-plugin', ExtensionParams>;

export const rules = { hasPluginName, hasAnnotation };
