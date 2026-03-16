import {
  ExtensionsApi,
  ExtensionsPlugin,
} from '@red-hat-developer-hub/backstage-plugin-extensions-common';
import { DEFAULT_NAMESPACE } from '@backstage/catalog-model';
import {
  FileInstallationStorage,
  InstallationStorage,
  PackageEntry,
} from './FileInstallationStorage';
import type { Config } from '@backstage/config';
import {
  InstallationInitError,
  InstallationInitErrorReason,
  InstallationInitErrorReasonKeys,
} from '../errors/InstallationInitError';
import { LoggerService } from '@backstage/backend-plugin-api';
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
   * Creates an InstallationDataService from config.
   *
   * Unlike the RHDH version, this does NOT block when NODE_ENV=production
   * and does NOT check the extensions.installation.enabled config flag.
   * Installation is always available when a valid file path is configured.
   */
  static fromConfig(deps: {
    config: Config;
    extensionsApi: ExtensionsApi;
    logger: LoggerService;
  }): InstallationDataService {
    const { config, extensionsApi, logger } = deps;

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

    try {
      const filePath = config.getOptionalString(
        'extensions.installation.saveToSingleFile.file',
      );
      if (!filePath) {
        return serviceWithInitializationError(
          InstallationInitErrorReason.FILE_CONFIG_VALUE_MISSING,
          "The 'extensions.installation.saveToSingleFile.file' config value is not being specified in the extensions configuration",
        );
      }

      const storage = new FileInstallationStorage(filePath);
      storage.initialize();
      logger.info(
        `Marketplace installation service initialized (file: ${filePath})`,
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

  getAllInstalledPackages(): PackageEntry[] {
    return this.installationStorage.getAllPackageEntries();
  }

  getPackageConfig(packageDynamicArtifact: string): string | undefined {
    return this.installationStorage.getPackage(packageDynamicArtifact);
  }

  async getPluginConfig(plugin: ExtensionsPlugin): Promise<string | undefined> {
    const dynamicArtifacts = await this.getPluginDynamicArtifacts(plugin);
    return this.installationStorage.getPackages(dynamicArtifacts);
  }

  updatePackageConfig(packageDynamicArtifact: string, newConfig: string): void {
    this.installationStorage.updatePackage(packageDynamicArtifact, newConfig);
  }

  async updatePluginConfig(
    plugin: ExtensionsPlugin,
    newConfig: string,
  ): Promise<void> {
    const dynamicArtifacts = await this.getPluginDynamicArtifacts(plugin);
    this.installationStorage.updatePackages(dynamicArtifacts, newConfig);
  }

  removePackage(packageDynamicArtifact: string): void {
    this.installationStorage.removePackage(packageDynamicArtifact);
  }

  setPackageDisabled(packageDynamicArtifact: string, disabled: boolean) {
    this.installationStorage.setPackageDisabled(
      packageDynamicArtifact,
      disabled,
    );
  }

  async setPluginDisabled(plugin: ExtensionsPlugin, disabled: boolean) {
    const dynamicArtifacts = await this.getPluginDynamicArtifacts(plugin);
    this.installationStorage.setPackagesDisabled(dynamicArtifacts, disabled);
  }
}
