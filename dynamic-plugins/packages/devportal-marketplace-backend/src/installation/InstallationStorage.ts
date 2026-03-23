export interface PackageEntry {
  package: string;
  disabled: boolean;
}

export interface InstallationStorage {
  initialize?(): Promise<void>;
  getPackage(packageName: string): Promise<string | undefined>;
  updatePackage(packageName: string, newConfig: string): Promise<void>;
  getPackages(packageNames: Set<string>): Promise<string | undefined>;
  updatePackages(packageNames: Set<string>, newConfig: string): Promise<void>;
  setPackageDisabled(packageName: string, disabled: boolean): Promise<void>;
  setPackagesDisabled(
    packageNames: Set<string>,
    disabled: boolean,
  ): Promise<void>;
  getAllPackageEntries(): Promise<PackageEntry[]>;
  removePackage(packageName: string): Promise<void>;
}
