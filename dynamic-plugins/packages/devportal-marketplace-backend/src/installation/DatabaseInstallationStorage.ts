import fs from 'fs';
import path from 'path';

import { Document, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import { LoggerService } from '@backstage/backend-plugin-api';
import { toBlockStyle } from '../utils/yamlFormat';
import {
  validatePackageFormat,
  validatePluginFormat,
} from '../validation/configValidation';
import type { Knex } from 'knex';
import type { InstallationStorage, PackageEntry } from './InstallationStorage';

const TABLE = 'marketplace_installations';

interface DbRow {
  package_name: string;
  disabled: boolean;
  config_yaml: string | null;
  updated_at: Date;
}

export class DatabaseInstallationStorage implements InstallationStorage {
  constructor(
    private readonly db: Knex,
    private readonly yamlFilePath: string | undefined,
    private readonly logger: LoggerService,
  ) {}

  async initialize(): Promise<void> {
    // __dirname points to dist/installation/ at runtime;
    // migrations/ lives at the package root (two levels up from dist/installation/)
    const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');
    await this.db.migrate.latest({ directory: migrationsDir });
    this.logger.info('Database migrations applied for marketplace installations');

    await this.seedFromFileIfEmpty();
    await this.syncToYamlFile();
  }

  /**
   * On first boot after migration from file-based storage, seed the DB
   * from the existing extensions-install.yaml if the table is empty.
   */
  private async seedFromFileIfEmpty(): Promise<void> {
    const [{ count }] = await this.db(TABLE).count('* as count');
    if (Number(count) > 0) return;

    if (!this.yamlFilePath || !fs.existsSync(this.yamlFilePath)) return;

    try {
      const raw = fs.readFileSync(this.yamlFilePath, 'utf-8');
      const doc = parseDocument(raw);
      const plugins = doc.get('plugins') as YAMLSeq | undefined;
      if (!plugins || plugins.items.length === 0) return;

      const rows: Array<Omit<DbRow, 'updated_at'>> = [];
      for (const item of plugins.items) {
        const map = item as YAMLMap;
        const pkgName = map.get('package') as string;
        if (!pkgName) continue;

        const disabled = (map.get('disabled') as boolean) ?? false;

        // Serialize just this entry as a single-item YAML map
        const entryDoc = new Document(map.toJSON());
        toBlockStyle(entryDoc.contents);
        const configYaml = entryDoc.toString({ lineWidth: 120 });

        rows.push({
          package_name: pkgName,
          disabled,
          config_yaml: configYaml,
        });
      }

      if (rows.length > 0) {
        await this.db(TABLE).insert(rows);
        this.logger.info(
          `Seeded ${rows.length} package(s) from ${this.yamlFilePath} into database`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `Failed to seed database from ${this.yamlFilePath}: ${e}`,
      );
    }
  }

  /**
   * Write-through: regenerate extensions-install.yaml from DB state.
   * This keeps the Python install script working on next container restart.
   */
  private async syncToYamlFile(): Promise<void> {
    if (!this.yamlFilePath) return;

    try {
      const rows = await this.db(TABLE)
        .select('config_yaml', 'package_name', 'disabled')
        .orderBy('package_name');

      const plugins: unknown[] = [];
      for (const row of rows) {
        if (row.config_yaml) {
          try {
            const entryDoc = parseDocument(row.config_yaml);
            plugins.push(entryDoc.toJSON());
          } catch {
            plugins.push({
              package: row.package_name,
              disabled: row.disabled,
            });
          }
        } else {
          plugins.push({
            package: row.package_name,
            disabled: row.disabled,
          });
        }
      }

      const doc = new Document({ plugins });
      toBlockStyle(doc.contents);
      const content = doc.toString({ lineWidth: 120 });

      const tmp = `${this.yamlFilePath}.tmp`;
      try {
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, this.yamlFilePath);
      } catch {
        fs.writeFileSync(this.yamlFilePath, content);
        try { fs.unlinkSync(tmp); } catch { /* ignore cleanup */ }
      }
    } catch (e) {
      this.logger.warn(`Failed to sync YAML write-through: ${e}`);
    }
  }

  async getPackage(packageName: string): Promise<string | undefined> {
    const row = await this.db(TABLE)
      .where('package_name', packageName)
      .first();
    if (!row) return undefined;
    return this.rowToYamlSequence(row);
  }

  async getPackages(packageNames: Set<string>): Promise<string | undefined> {
    const rows = await this.db(TABLE)
      .whereIn('package_name', [...packageNames]);
    if (rows.length === 0) return undefined;
    return this.rowsToYamlSequence(rows);
  }

  async updatePackage(
    packageName: string,
    newConfig: string,
  ): Promise<void> {
    const newNode = parseDocument(newConfig).contents;
    validatePackageFormat(newNode, packageName);

    const configYaml = newConfig;
    const disabled =
      (newNode as YAMLMap).get('disabled') as boolean ?? false;

    await this.db(TABLE)
      .insert({
        package_name: packageName,
        disabled,
        config_yaml: configYaml,
        updated_at: this.db.fn.now(),
      })
      .onConflict('package_name')
      .merge({
        disabled,
        config_yaml: configYaml,
        updated_at: this.db.fn.now(),
      });

    await this.syncToYamlFile();
  }

  async updatePackages(
    packageNames: Set<string>,
    newConfig: string,
  ): Promise<void> {
    const newNodes = parseDocument(newConfig);
    validatePluginFormat(newNodes, packageNames);

    await this.db.transaction(async trx => {
      for (const item of (newNodes.contents as YAMLSeq).items) {
        const map = item as YAMLMap;
        const pkgName = map.get('package') as string;
        const disabled = (map.get('disabled') as boolean) ?? false;

        const entryDoc = new Document(map.toJSON());
        toBlockStyle(entryDoc.contents);
        const configYaml = entryDoc.toString({ lineWidth: 120 });

        await trx(TABLE)
          .insert({
            package_name: pkgName,
            disabled,
            config_yaml: configYaml,
            updated_at: trx.fn.now(),
          })
          .onConflict('package_name')
          .merge({
            disabled,
            config_yaml: configYaml,
            updated_at: trx.fn.now(),
          });
      }
    });

    await this.syncToYamlFile();
  }

  async setPackageDisabled(
    packageName: string,
    disabled: boolean,
  ): Promise<void> {
    const existing = await this.db(TABLE)
      .where('package_name', packageName)
      .first();

    if (existing) {
      // Update disabled flag in both the row and the stored YAML
      let configYaml = existing.config_yaml;
      if (configYaml) {
        try {
          const doc = parseDocument(configYaml);
          (doc.contents as YAMLMap).set('disabled', disabled);
          toBlockStyle(doc.contents);
          configYaml = doc.toString({ lineWidth: 120 });
        } catch {
          // If YAML parsing fails, just update the column
        }
      }
      await this.db(TABLE).where('package_name', packageName).update({
        disabled,
        config_yaml: configYaml,
        updated_at: this.db.fn.now(),
      });
    } else {
      const entry = { package: packageName, disabled };
      const doc = new Document(entry);
      toBlockStyle(doc.contents);
      await this.db(TABLE).insert({
        package_name: packageName,
        disabled,
        config_yaml: doc.toString({ lineWidth: 120 }),
        updated_at: this.db.fn.now(),
      });
    }

    await this.syncToYamlFile();
  }

  async setPackagesDisabled(
    packageNames: Set<string>,
    disabled: boolean,
  ): Promise<void> {
    await this.db.transaction(async trx => {
      for (const packageName of packageNames) {
        const existing = await trx(TABLE)
          .where('package_name', packageName)
          .first();

        if (existing) {
          let configYaml = existing.config_yaml;
          if (configYaml) {
            try {
              const doc = parseDocument(configYaml);
              (doc.contents as YAMLMap).set('disabled', disabled);
              toBlockStyle(doc.contents);
              configYaml = doc.toString({ lineWidth: 120 });
            } catch { /* keep existing */ }
          }
          await trx(TABLE).where('package_name', packageName).update({
            disabled,
            config_yaml: configYaml,
            updated_at: trx.fn.now(),
          });
        } else {
          const entry = { package: packageName, disabled };
          const doc = new Document(entry);
          toBlockStyle(doc.contents);
          await trx(TABLE).insert({
            package_name: packageName,
            disabled,
            config_yaml: doc.toString({ lineWidth: 120 }),
            updated_at: trx.fn.now(),
          });
        }
      }
    });

    await this.syncToYamlFile();
  }

  async getAllPackageEntries(): Promise<PackageEntry[]> {
    const rows = await this.db(TABLE)
      .select('package_name', 'disabled')
      .orderBy('package_name');

    return rows.map(row => ({
      package: row.package_name,
      disabled: row.disabled,
    }));
  }

  async removePackage(packageName: string): Promise<void> {
    await this.db(TABLE).where('package_name', packageName).delete();
    await this.syncToYamlFile();
  }

  /**
   * Convert a single DB row to a YAML sequence string (matching
   * FileInstallationStorage.getPackage() output format).
   */
  private rowToYamlSequence(row: DbRow): string {
    if (row.config_yaml) {
      try {
        const entryDoc = parseDocument(row.config_yaml);
        const seqDoc = new Document([entryDoc.toJSON()]);
        toBlockStyle(seqDoc.contents);
        return seqDoc.toString({ lineWidth: 120 });
      } catch { /* fall through */ }
    }
    const seqDoc = new Document([
      { package: row.package_name, disabled: row.disabled },
    ]);
    toBlockStyle(seqDoc.contents);
    return seqDoc.toString({ lineWidth: 120 });
  }

  /**
   * Convert multiple DB rows to a YAML sequence string (matching
   * FileInstallationStorage.getPackages() output format).
   */
  private rowsToYamlSequence(rows: DbRow[]): string {
    const items: unknown[] = rows.map(row => {
      if (row.config_yaml) {
        try {
          return parseDocument(row.config_yaml).toJSON();
        } catch { /* fall through */ }
      }
      return { package: row.package_name, disabled: row.disabled };
    });
    const seqDoc = new Document(items);
    toBlockStyle(seqDoc.contents);
    return seqDoc.toString({ lineWidth: 120 });
  }
}
