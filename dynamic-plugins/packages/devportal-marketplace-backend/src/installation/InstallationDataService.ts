import {
  ExtensionsApi,
  ExtensionsPlugin,
} from '@red-hat-developer-hub/backstage-plugin-extensions-common';
import { DEFAULT_NAMESPACE } from '@backstage/catalog-model';
import { FileInstallationStorage } from './FileInstallationStorage';
import { DatabaseInstallationStorage } from './DatabaseInstallationStorage';
import type { InstallationStorage, PackageEntry } from './InstallationStorage';
import type { Config } from '@backstage/config';
import {
  InstallationInitError,
  InstallationInitErrorReason,
  InstallationInitErrorReasonKeys,
} from '../errors/InstallationInitError';
import { DatabaseService, LoggerService } from '@backstage/backend-plugin-api';
import { ConfigFormatError } from '../errors/ConfigFormatError';

export class InstallationDataService {
  private constructor(
    private readonly extensionsApi: ExtensionsApi,
    private readonly _installationStorage?: InstallationStorage,
    private readonly initializationError?: InstallationInitError,
  ) {}

  private get installationStorage(): InstallationStorage {
    if (!this._installationStorage) {
      throw new Error('Installation storage is not initialized', {
        cause: this.initializationError,
      });
    }
    return this._installationStorage;
  }

  /**
   * Creates an InstallationDataService backed by the Backstage database.
   * Falls back to file-based storage if the database is unavailable.
   *
   * The YAML file path from config is still used for write-through:
   * every DB mutation regenerates extensions-install.yaml so the Python
   * install script can read it on the next container restart.
   */
  static async create(deps: {
    config: Config;
    extensionsApi: ExtensionsApi;
    logger: LoggerService;
    database: DatabaseService;
  }): Promise<InstallationDataService> {
    const { config, extensionsApi, logger, database } = deps;

    const serviceWithInitializationError = (
      reason: InstallationInitErrorReasonKeys,
      message: string,
      cause?: Error,
    ): InstallationDataService => {
      logger.error(
        `Installation feature is disabled. Error while loading data: ${message}`,
      );
      return new InstallationDataService(
        extensionsApi,
        undefined,
        new InstallationInitError(reason, message, cause),
      );
    };

    const yamlFilePath = config.getOptionalString(
      'extensions.installation.saveToSingleFile.file',
    );

    // Try database-backed storage first
    try {
      const knexClient = await database.getClient();
      const storage = new DatabaseInstallationStorage(
        knexClient,
        yamlFilePath,
        logger,
      );
      await storage.initialize();
      logger.info(
        'Marketplace installation service initialized (database-backed)',
      );
      return new InstallationDataService(extensionsApi, storage);
    } catch (dbError) {
      logger.warn(
        `Database storage initialization failed, falling back to file storage: ${dbError}`,
      );
    }

    // Fallback: file-based storage
    try {
      if (!yamlFilePath) {
        return serviceWithInitializationError(
          InstallationInitErrorReason.FILE_CONFIG_VALUE_MISSING,
          "Database unavailable and 'extensions.installation.saveToSingleFile.file' config value is not specified",
        );
      }

      const storage = new FileInstallationStorage(yamlFilePath);
      await storage.initialize();
      logger.info(
        `Marketplace installation service initialized (file fallback: ${yamlFilePath})`,
      );
      return new InstallationDataService(extensionsApi, storage);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      let reason: InstallationInitErrorReasonKeys;
      if (e instanceof InstallationInitError) {
        reason = e.reason;
      } else if (e instanceof ConfigFormatError) {
        reason = InstallationInitErrorReason.INVALID_CONFIG;
      } else {
        reason = InstallationInitErrorReason.UNKNOWN;
      }
      return serviceWithInitializationError(
        reason,
        err.message,
        reason === InstallationInitErrorReason.UNKNOWN ? err : undefined,
      );
    }
  }

  private async getPluginDynamicArtifacts(
    plugin: ExtensionsPlugin,
  ): Promise<Set<string>> {
    const extensionsPackages = await this.extensionsApi.getPluginPackages(
      plugin.metadata.namespace ?? DEFAULT_NAMESPACE,
      plugin.metadata.name,
    );

    return new Set(
      extensionsPackages.flatMap(p =>
        p.spec?.dynamicArtifact ? [p.spec.dynamicArtifact] : [],
      ),
    );
  }

  getInitializationError(): InstallationInitError | undefined {
    return this.initializationError;
  }

  async getAllInstalledPackages(): Promise<PackageEntry[]> {
    return this.installationStorage.getAllPackageEntries();
  }

  async getPackageConfig(
    packageDynamicArtifact: string,
  ): Promise<string | undefined> {
    return this.installationStorage.getPackage(packageDynamicArtifact);
  }

  async getPluginConfig(
    plugin: ExtensionsPlugin,
  ): Promise<string | undefined> {
    const dynamicArtifacts = await this.getPluginDynamicArtifacts(plugin);
    return this.installationStorage.getPackages(dynamicArtifacts);
  }

  async updatePackageConfig(
    packageDynamicArtifact: string,
    newConfig: string,
  ): Promise<void> {
    await this.installationStorage.updatePackage(
      packageDynamicArtifact,
      newConfig,
    );
  }

  async updatePluginConfig(
    plugin: ExtensionsPlugin,
    newConfig: string,
  ): Promise<void> {
    const dynamicArtifacts = await this.getPluginDynamicArtifacts(plugin);
    await this.installationStorage.updatePackages(dynamicArtifacts, newConfig);
  }

  async removePackage(packageDynamicArtifact: string): Promise<void> {
    await this.installationStorage.removePackage(packageDynamicArtifact);
  }

  async setPackageDisabled(
    packageDynamicArtifact: string,
    disabled: boolean,
  ): Promise<void> {
    await this.installationStorage.setPackageDisabled(
      packageDynamicArtifact,
      disabled,
    );
  }

  async setPluginDisabled(
    plugin: ExtensionsPlugin,
    disabled: boolean,
  ): Promise<void> {
    const dynamicArtifacts = await this.getPluginDynamicArtifacts(plugin);
    await this.installationStorage.setPackagesDisabled(
      dynamicArtifacts,
      disabled,
    );
  }
}
