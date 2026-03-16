import { Document, isMap, isSeq, type YAMLMap, type YAMLSeq } from 'yaml';
import { ConfigFormatError } from '../errors/ConfigFormatError';
import type { JsonValue } from '@backstage/types';

export function validateConfigurationFormat(
  doc: Document,
): asserts doc is Document & {
  contents: YAMLMap<string, JsonValue>;
} {
  if (!isMap(doc.contents)) {
    throw new ConfigFormatError(
      'Invalid installation configuration, expected a map',
    );
  }

  const plugins = doc.get('plugins');

  if (!isSeq(plugins))
    throw new ConfigFormatError(
      "Invalid installation configuration, 'plugins' field must be a list",
    );
  for (const item of plugins.items) {
    validatePackageFormat(item);
  }
}

export function validatePackageFormat(
  item: unknown,
  packageName?: string,
): asserts item is YAMLMap<string, JsonValue> {
  if (!isMap(item)) {
    throw new ConfigFormatError(
      'Invalid installation configuration, package item must be a map',
    );
  }

  const packageToValidate = item.get('package');
  if (
    typeof packageToValidate !== 'string' ||
    packageToValidate.trim() === ''
  ) {
    throw new ConfigFormatError(
      "Invalid installation configuration, 'package' field in package item must be a non-empty string",
    );
  }

  const disabled = item.get('disabled');
  if (disabled && typeof disabled !== 'boolean') {
    throw new ConfigFormatError(
      "Invalid installation configuration, optional 'disabled' field in package item must be a boolean",
    );
  }

  const pluginConfig = item.get('pluginConfig');
  if (pluginConfig && !isMap(pluginConfig)) {
    throw new ConfigFormatError(
      "Invalid installation configuration, optional 'pluginConfig' field in package item must be a map",
    );
  }

  const integrity = item.get('integrity');
  if (integrity && (typeof integrity !== 'string' || integrity.trim() === '')) {
    throw new ConfigFormatError(
      "Invalid installation configuration, optional 'integrity' field in package item must be a non-empty string",
    );
  }

  if (packageName && packageToValidate !== packageName) {
    throw new ConfigFormatError(
      `Invalid installation configuration, 'package' field value in package item differs from '${packageName}'`,
    );
  }
}

export function validatePluginFormat(
  doc: Document,
  pluginPackages: Set<string>,
): asserts doc is Document & {
  contents: YAMLSeq<YAMLMap<string, JsonValue>>;
} {
  if (!isSeq(doc.contents))
    throw new ConfigFormatError(
      'Invalid installation configuration, plugin packages must be a list',
    );
  for (const item of doc.contents.items) {
    validatePackageFormat(item);
    const packageToValidate = item.get('package') as string;
    if (!pluginPackages.has(packageToValidate)) {
      throw new ConfigFormatError(
        `Invalid configuration, package '${packageToValidate}' is not part of plugin configuration`,
      );
    }
  }
}
