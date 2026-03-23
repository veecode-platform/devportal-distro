import fs from 'fs';

import { Document, isMap, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import {
  validateConfigurationFormat,
  validatePackageFormat,
  validatePluginFormat,
} from '../validation/configValidation';
import {
  InstallationInitError,
  InstallationInitErrorReason,
} from '../errors/InstallationInitError';
import { toBlockStyle } from '../utils/yamlFormat';
import type { JsonValue } from '@backstage/types';
import type { InstallationStorage, PackageEntry } from './InstallationStorage';

export class FileInstallationStorage implements InstallationStorage {
  private readonly configFile: string;
  private config: Document;

  constructor(configFile: string) {
    this.configFile = configFile;
    this.config = new Document();
  }

  private get packages(): YAMLSeq<YAMLMap<string, JsonValue>> {
    return this.config.get('plugins') as YAMLSeq<YAMLMap<string, JsonValue>>;
  }

  private serializeYaml(doc: Document): string {
    toBlockStyle(doc.contents);
    return doc.toString({ lineWidth: 120 });
  }

  private toStringYaml(mapNodes: YAMLMap<string, JsonValue>[]): string {
    const tempDoc = new Document(mapNodes);
    return this.serializeYaml(tempDoc);
  }

  private getPackageYamlMap(
    packageName: string,
  ): YAMLMap<string, JsonValue> | undefined {
    return this.packages.items.find(
      p => isMap(p) && p.get('package') === packageName,
    );
  }

  private save() {
    const content = this.serializeYaml(this.config);
    const tmp = `${this.configFile}.tmp`;
    try {
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, this.configFile);
    } catch {
      // rename fails on Docker bind mounts (EBUSY) — write directly
      fs.writeFileSync(this.configFile, content);
      try { fs.unlinkSync(tmp); } catch { /* ignore cleanup */ }
    }
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.configFile)) {
      throw new InstallationInitError(
        InstallationInitErrorReason.FILE_NOT_EXISTS,
        `The file ${this.configFile} is missing`,
      );
    }
    const rawContent = fs.readFileSync(this.configFile, 'utf-8');
    const parsedContent = parseDocument(rawContent);
    validateConfigurationFormat(parsedContent);
    this.config = parsedContent;
  }

  getConfigYaml(): string {
    return this.serializeYaml(this.config);
  }

  async getPackage(packageName: string): Promise<string | undefined> {
    const res = this.getPackageYamlMap(packageName);
    return res ? this.toStringYaml([res]) : res;
  }

  async getPackages(packageNames: Set<string>): Promise<string | undefined> {
    const res = [];
    for (const packageName of packageNames) {
      const packageMap = this.getPackageYamlMap(packageName);
      if (packageMap) {
        res.push(packageMap);
      }
    }
    return res.length === 0 ? undefined : this.toStringYaml(res);
  }

  async updatePackage(packageName: string, newConfig: string): Promise<void> {
    const newNode = parseDocument(newConfig).contents;
    validatePackageFormat(newNode, packageName);

    const existingPackage = this.packages.items.find(
      item => item.get('package') === packageName,
    );
    if (existingPackage) {
      existingPackage.items = newNode.items;
    } else {
      this.packages.items.push(newNode);
    }
    this.save();
  }

  async updatePackages(packageNames: Set<string>, newConfig: string): Promise<void> {
    const newNodes = parseDocument(newConfig);
    validatePluginFormat(newNodes, packageNames);

    const updatedPackages = new YAMLSeq<YAMLMap<string, JsonValue>>();
    for (const item of this.packages.items) {
      const name = item.get('package') as string;
      if (!packageNames.has(name)) {
        updatedPackages.items.push(item); // keep unchanged package of different plugin
      }
    }
    updatedPackages.items.push(...newNodes.contents.items);

    this.config.set('plugins', updatedPackages);
    this.save();
  }

  async setPackageDisabled(packageName: string, disabled: boolean): Promise<void> {
    let pkg = this.getPackageYamlMap(packageName);
    if (!pkg) {
      pkg = new YAMLMap<string, JsonValue>();
      pkg.set('package', packageName);
      this.packages.add(pkg);
    }
    pkg.set('disabled', disabled);
    this.save();
  }

  async getAllPackageEntries(): Promise<PackageEntry[]> {
    // Re-read from disk to get the current persisted state (in-memory Document
    // may lag behind if initialize() was called long ago).
    const rawContent = fs.readFileSync(this.configFile, 'utf-8');
    const freshConfig = parseDocument(rawContent);
    const plugins = freshConfig.get('plugins') as YAMLSeq<YAMLMap<string, JsonValue>>;
    if (!plugins) return [];
    return plugins.items.map(item => ({
      package: item.get('package') as string,
      disabled: (item.get('disabled') as boolean) ?? false,
    }));
  }

  async removePackage(packageName: string): Promise<void> {
    const idx = this.packages.items.findIndex(
      p => isMap(p) && p.get('package') === packageName,
    );
    if (idx !== -1) {
      this.packages.items.splice(idx, 1);
      this.save();
    }
  }

  async setPackagesDisabled(packageNames: Set<string>, disabled: boolean): Promise<void> {
    const packages = this.config.get('plugins') as YAMLSeq<
      YAMLMap<string, JsonValue>
    >;
    const packageMap = packages.items.reduce(
      (map, item) => map.set(item.get('package') as string, item),
      new Map<string, YAMLMap<string, JsonValue>>(),
    );
    for (const packageName of packageNames) {
      let item = packageMap.get(packageName);
      if (!item) {
        item = new YAMLMap<string, JsonValue>();
        item.set('package', packageName);
        packages.add(item);
      }
      item.set('disabled', disabled);
    }

    this.save();
  }
}
