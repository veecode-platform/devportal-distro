#
# Copyright (c) 2023 Red Hat, Inc.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

import copy
from enum import StrEnum
import hashlib
import json
import os
import sys
import tempfile
import yaml
import tarfile
import shutil
import subprocess
import base64
import binascii
import atexit
import time
import signal

"""
Dynamic Plugin Installer for Backstage Application

This script is used to install dynamic plugins in the Backstage application, and is available in the container image to be called at container initialization, for example in an init container when using Kubernetes.

It expects, as the only argument, the path to the root directory where the dynamic plugins will be installed.

Environment Variables:
    MAX_ENTRY_SIZE: Maximum size of a file in the archive (default: 20MB)
    SKIP_INTEGRITY_CHECK: Set to "true" to skip integrity check of remote packages

Configuration:
    The script expects the `dynamic-plugins.yaml` file to be present in the current directory and to contain the list of plugins to install along with their optional configuration.

    The `dynamic-plugins.yaml` file must contain:
    - a `plugins` list of objects with the following properties:
        - `package`: the package to install (NPM package name, local path starting with './', or OCI image starting with 'oci://')
        - `integrity`: a string containing the integrity hash of the package (required for remote NPM packages unless SKIP_INTEGRITY_CHECK is set, optional for local packages, not used for OCI packages)
        - `pluginConfig`: an optional plugin-specific configuration fragment
        - `disabled`: an optional boolean to disable the plugin (`false` by default)
        - `pullPolicy`: download behavior control - 'IfNotPresent' (default) or 'Always' (OCI packages with ':latest!' default to 'Always')
        - `forceDownload`: an optional boolean to force download for NPM packages even if already installed (`false` by default)
    - an optional `includes` list of yaml files to include, each file containing a list of plugins

    The plugins listed in the included files will be included in the main list of considered plugins and possibly overwritten by the plugins already listed in the main `plugins` list.

    A simple empty example `dynamic-plugins.yaml` file:

    ```yaml
    includes:
      - dynamic-plugins.default.yaml
    plugins: []
    ```

Package Types:
    1. NPM packages: Standard package names (e.g., '@backstage/plugin-catalog')
    2. Local packages: Paths starting with './' (e.g., './my-local-plugin') - automatically detects changes via package.json version, modification times, and lock files
    3. OCI packages: Images starting with 'oci://' (e.g., 'oci://quay.io/user/plugin:v1.0!plugin-name')

Pull Policies:
    - IfNotPresent: Only download if not already installed (default for most packages)
    - Always: Always check for updates and download if different (default for OCI packages with ':latest!' tag)

Process:
    For each enabled plugin mentioned in the main `plugins` list and the various included files, the script will:
    - For NPM packages: call `npm pack` to get the package archive and extract it
    - For OCI packages: use `skopeo` to download and extract the specified plugin from the container image
    - For local packages: pack and extract from the local filesystem
    - Verify package integrity (for remote NPM packages only, unless skipped)
    - Track installation state using hash files to detect changes and avoid unnecessary re-downloads
    - Merge the plugin-specific configuration fragment in a global configuration file named `app-config.dynamic-plugins.yaml`

"""

class PullPolicy(StrEnum):
    IF_NOT_PRESENT = 'IfNotPresent'
    ALWAYS = 'Always'
    # NEVER = 'Never' not needed

class InstallException(Exception):
    """Exception class from which every exception in this library will derive."""
    pass

class PluginInstaller:
    """Base class for plugin installers with common functionality."""
    
    def __init__(self, destination: str, skip_integrity_check: bool = False):
        self.destination = destination
        self.skip_integrity_check = skip_integrity_check
        
    def should_skip_installation(self, plugin: dict, plugin_path_by_hash: dict) -> tuple[bool, str]:
        """Check if plugin installation should be skipped based on pull policy and current state."""
        plugin_hash = plugin['hash']
        pull_policy = plugin.get('pullPolicy', PullPolicy.IF_NOT_PRESENT)
        force_download = plugin.get('forceDownload', False)
        
        if plugin_hash not in plugin_path_by_hash:
            return False, "not_installed"
            
        if pull_policy == PullPolicy.ALWAYS or force_download:
            return False, "force_download"
            
        return True, "already_installed"
    
    def install(self, plugin: dict, plugin_path_by_hash: dict) -> str:
        """Install a plugin and return the plugin path. Must be implemented by subclasses."""
        raise NotImplementedError()

class OciDownloader:
    """Helper class for downloading and extracting plugins from OCI container images."""
    
    def __init__(self, destination: str):
        self._skopeo = shutil.which('skopeo')
        if self._skopeo is None:
            raise InstallException('skopeo executable not found in PATH')

        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = self.tmp_dir_obj.name
        self.image_to_tarball = {}
        self.destination = destination
        self.max_entry_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))

    def skopeo(self, command):
        rv = subprocess.run([self._skopeo] + command, check=True, capture_output=True)
        if rv.returncode != 0:
            raise InstallException(f'Error while running skopeo command: {rv.stderr}')
        return rv.stdout

    def get_plugin_tar(self, image: str) -> str:
        if image not in self.image_to_tarball:
            # run skopeo copy to copy the tar ball to the local filesystem
            print(f'\t==> Copying image {image} to local filesystem', flush=True)
            image_digest = hashlib.sha256(image.encode('utf-8'), usedforsecurity=False).hexdigest()
            local_dir = os.path.join(self.tmp_dir, image_digest)
            # replace oci:// prefix with docker://
            image_url = image.replace('oci://', 'docker://')
            self.skopeo(['copy', image_url, f'dir:{local_dir}'])
            manifest_path = os.path.join(local_dir, 'manifest.json')
            manifest = json.load(open(manifest_path))
            # get the first layer of the image
            layer = manifest['layers'][0]['digest']
            (_sha, filename) = layer.split(':')
            local_path = os.path.join(local_dir, filename)
            self.image_to_tarball[image] = local_path

        return self.image_to_tarball[image]

    def extract_plugin(self, tar_file: str, plugin_path: str) -> None:
        with tarfile.open(tar_file, 'r:gz') as tar: # NOSONAR
            # extract only the files in specified directory
            filesToExtract = []
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue
                # zip bomb protection
                if member.size > self.max_entry_size:
                    raise InstallException('Zip bomb detected in ' + member.name)

                if member.islnk() or member.issym():
                    realpath = os.path.realpath(os.path.join(plugin_path, *os.path.split(member.linkname)))
                    if not realpath.startswith(plugin_path):
                        print(f'\t==> WARNING: skipping file containing link outside of the archive: ' + member.name + ' -> ' + member.linkpath)
                        continue

                filesToExtract.append(member)
            tar.extractall(os.path.abspath(self.destination), members=filesToExtract, filter='tar')

    def download(self, package: str) -> str:
        # split by ! to get the path in the image
        (image, plugin_path) = package.split('!')
        tar_file = self.get_plugin_tar(image)
        plugin_directory = os.path.join(self.destination, plugin_path)
        if os.path.exists(plugin_directory):
            print('\t==> Removing previous plugin directory', plugin_directory, flush=True)
            shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)
        self.extract_plugin(tar_file=tar_file, plugin_path=plugin_path)
        return plugin_path
    
    def digest(self, package: str) -> str:
        (image, _) = package.split('!')
        image_url = image.replace('oci://', 'docker://')
        output = self.skopeo(['inspect', image_url])
        data = json.loads(output)
        # OCI artifact digest field is defined as "hash method" ":" "hash"
        digest = data['Digest'].split(':')[1]
        return f"{digest}"

class OciPluginInstaller(PluginInstaller):
    """Handles OCI container-based plugin installation using skopeo."""
    
    def __init__(self, destination: str, skip_integrity_check: bool = False):
        super().__init__(destination, skip_integrity_check)
        self.downloader = OciDownloader(destination)
        
    def should_skip_installation(self, plugin: dict, plugin_path_by_hash: dict) -> tuple[bool, str]:
        """OCI packages have special digest-based checking for ALWAYS pull policy."""
        package = plugin['package']
        plugin_hash = plugin['hash']
        pull_policy = plugin.get('pullPolicy', PullPolicy.ALWAYS if ':latest!' in package else PullPolicy.IF_NOT_PRESENT)
        
        if plugin_hash not in plugin_path_by_hash:
            return False, "not_installed"
            
        if pull_policy == PullPolicy.IF_NOT_PRESENT:
            return True, "already_installed"
            
        if pull_policy == PullPolicy.ALWAYS:
            # Check if digest has changed
            installed_path = plugin_path_by_hash[plugin_hash]
            digest_file_path = os.path.join(self.destination, installed_path, 'dynamic-plugin-image.hash')
            
            local_digest = None
            if os.path.isfile(digest_file_path):
                with open(digest_file_path, 'r') as f:
                    local_digest = f.read().strip()
                    
            remote_digest = self.downloader.digest(package)
            if remote_digest == local_digest:
                return True, "digest_unchanged"
                
        return False, "force_download"
    
    def install(self, plugin: dict, plugin_path_by_hash: dict) -> str:
        """Install an OCI plugin package."""
        package = plugin['package']
        
        try:
            plugin_path = self.downloader.download(package)
            
            # Save digest for future comparison
            digest_file_path = os.path.join(self.destination, plugin_path, 'dynamic-plugin-image.hash')
            with open(digest_file_path, 'w') as f:
                f.write(self.downloader.digest(package))
                
            # Clean up duplicate hashes
            for key in [k for k, v in plugin_path_by_hash.items() if v == plugin_path]:
                plugin_path_by_hash.pop(key)
                
            return plugin_path
            
        except Exception as e:
            raise InstallException(f"Error while installing OCI plugin {package}: {e}")

class NpmPluginInstaller(PluginInstaller):
    """Handles NPM and local package installation using npm pack."""
    
    def __init__(self, destination: str, skip_integrity_check: bool = False):
        super().__init__(destination, skip_integrity_check)
        self.max_entry_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
    
    def install(self, plugin: dict, plugin_path_by_hash: dict) -> str:
        """Install an NPM or local plugin package."""
        package = plugin['package']
        package_is_local = package.startswith('./')
        
        if package_is_local:
            package = os.path.join(os.getcwd(), package[2:])
        
        # Verify integrity requirements
        if not package_is_local and not self.skip_integrity_check and 'integrity' not in plugin:
            raise InstallException(f"No integrity hash provided for Package {package}")
        
        # Download package
        print('\t==> Grabbing package archive through `npm pack`', flush=True)
        result = subprocess.run(['npm', 'pack', package], capture_output=True, cwd=self.destination)
        if result.returncode != 0:
            raise InstallException(f'Error while installing plugin {package} with \'npm pack\' : {result.stderr.decode("utf-8")}')
        
        archive = os.path.join(self.destination, result.stdout.decode('utf-8').strip())
        
        # Verify integrity for remote packages
        if not (package_is_local or self.skip_integrity_check):
            print('\t==> Verifying package integrity', flush=True)
            verify_package_integrity(plugin, archive, self.destination)
        
        # Extract package
        plugin_path = self._extract_npm_package(archive)
        
        return plugin_path
    
    def _extract_npm_package(self, archive: str) -> str:
        """Extract NPM package archive with security protections."""
        directory = archive.replace('.tgz', '')
        directory_realpath = os.path.realpath(directory)
        plugin_path = os.path.basename(directory_realpath)
        
        if os.path.exists(directory):
            print('\t==> Removing previous plugin directory', directory, flush=True)
            shutil.rmtree(directory, ignore_errors=True)
        os.mkdir(directory)
        
        print('\t==> Extracting package archive', archive, flush=True)
        with tarfile.open(archive, 'r:gz') as tar:
            for member in tar.getmembers():
                if member.isreg():
                    if not member.name.startswith('package/'):
                        raise InstallException(f"NPM package archive does not start with 'package/' as it should: {member.name}")
                    
                    if member.size > self.max_entry_size:
                        raise InstallException(f'Zip bomb detected in {member.name}')
                    
                    member.name = member.name.removeprefix('package/')
                    tar.extract(member, path=directory, filter='tar')
                    
                elif member.isdir():
                    print('\t\tSkipping directory entry', member.name, flush=True)
                    
                elif member.islnk() or member.issym():
                    if not member.linkpath.startswith('package/'):
                        raise InstallException(f'NPM package archive contains a link outside of the archive: {member.name} -> {member.linkpath}')
                    
                    member.name = member.name.removeprefix('package/')
                    member.linkpath = member.linkpath.removeprefix('package/')
                    
                    realpath = os.path.realpath(os.path.join(directory, *os.path.split(member.linkname)))
                    if not realpath.startswith(directory_realpath):
                        raise InstallException(f'NPM package archive contains a link outside of the archive: {member.name} -> {member.linkpath}')
                    
                    tar.extract(member, path=directory, filter='tar')
                    
                else:
                    type_mapping = {
                        tarfile.CHRTYPE: "character device",
                        tarfile.BLKTYPE: "block device", 
                        tarfile.FIFOTYPE: "FIFO"
                    }
                    type_str = type_mapping.get(member.type, "unknown")
                    raise InstallException(f'NPM package archive contains a non regular file: {member.name} - {type_str}')
        
        print('\t==> Removing package archive', archive, flush=True)
        os.remove(archive)
        
        return plugin_path

def create_plugin_installer(package: str, destination: str, skip_integrity_check: bool = False) -> PluginInstaller:
    """Factory function to create appropriate plugin installer based on package type."""
    if package.startswith('oci://'):
        return OciPluginInstaller(destination, skip_integrity_check)
    else:
        return NpmPluginInstaller(destination, skip_integrity_check)

def install_plugin(plugin: dict, plugin_path_by_hash: dict, destination: str, skip_integrity_check: bool = False) -> tuple[str, dict]:
    """Install a single plugin and handle configuration merging."""
    package = plugin['package']
    
    # Check if plugin is disabled
    if plugin.get('disabled', False):
        print(f'\n======= Skipping disabled dynamic plugin {package}', flush=True)
        return None, {}
    
    # Create appropriate installer
    installer = create_plugin_installer(package, destination, skip_integrity_check)
    
    # Check if installation should be skipped
    should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)
    if should_skip:
        print(f'\n======= Skipping download of already installed dynamic plugin {package} ({reason})', flush=True)
        # Remove from tracking dict so we don't delete it later
        if plugin['hash'] in plugin_path_by_hash:
            plugin_path_by_hash.pop(plugin['hash'])
        return None, plugin.get('pluginConfig', {})
    
    # Install the plugin
    print(f'\n======= Installing dynamic plugin {package}', flush=True)
    plugin_path = installer.install(plugin, plugin_path_by_hash)
    
    # Create hash file for tracking
    hash_file_path = os.path.join(destination, plugin_path, 'dynamic-plugin-config.hash')
    with open(hash_file_path, 'w') as f:
        f.write(plugin['hash'])
    
    print(f'\t==> Successfully installed dynamic plugin {package}', flush=True)
    
    return plugin_path, plugin.get('pluginConfig', {})

RECOGNIZED_ALGORITHMS = (
    'sha512',
    'sha384',
    'sha256',
)

def merge(source, destination, prefix = ''):
    for key, value in source.items():
        if isinstance(value, dict):
            # get node or create one
            node = destination.setdefault(key, {})
            merge(value, node, key + '.')
        else:
            # if key exists in destination trigger an error
            if key in destination and destination[key] != value:
                raise InstallException(f"Config key '{ prefix + key }' defined differently for 2 dynamic plugins")

            destination[key] = value

    return destination

def get_local_package_info(package_path: str) -> dict:
    """Get package information from a local package to include in hash calculation."""
    try:
        if package_path.startswith('./'):
            abs_package_path = os.path.join(os.getcwd(), package_path[2:])
        else:
            abs_package_path = package_path
            
        package_json_path = os.path.join(abs_package_path, 'package.json')
        
        if not os.path.isfile(package_json_path):
            # If no package.json, fall back to directory modification time
            if os.path.isdir(abs_package_path):
                mtime = os.path.getmtime(abs_package_path)
                return {'_directory_mtime': mtime}
            else:
                return {'_not_found': True}
        
        with open(package_json_path, 'r') as f:
            package_json = json.load(f)
            
        # Extract relevant fields that indicate package changes
        info = {}
        info['_package_json'] = package_json
                
        # Also include package.json modification time as additional change detection
        info['_package_json_mtime'] = os.path.getmtime(package_json_path)
        
        # Include package-lock.json or yarn.lock modification time if present
        for lock_file in ['package-lock.json', 'yarn.lock']:
            lock_path = os.path.join(abs_package_path, lock_file)
            if os.path.isfile(lock_path):
                info[f'_{lock_file}_mtime'] = os.path.getmtime(lock_path)
                
        return info
        
    except (json.JSONDecodeError, OSError, IOError) as e:
        # If we can't read the package info, include the error in hash
        # This ensures we'll try to reinstall if there are permission issues, etc.
        return {'_error': str(e)}

def maybeMergeConfig(config, globalConfig):
    if config is not None and isinstance(config, dict):
        print('\t==> Merging plugin-specific configuration', flush=True)
        return merge(config, globalConfig)
    else:
        return globalConfig

def mergePlugin(plugin: dict, allPlugins: dict, dynamicPluginsFile: str):
    package = plugin['package']
    if not isinstance(package, str):
        raise InstallException(f"content of the \'plugins.package\' field must be a string in {dynamicPluginsFile}")

    # if `package` already exists in `allPlugins`, then override its fields
    if package not in allPlugins:
        allPlugins[package] = plugin
        return

    # override the included plugins with fields in the main plugins list
    print('\n======= Overriding dynamic plugin configuration', package, flush=True)
    for key in plugin:
        if key == 'package':
            continue
        allPlugins[package][key] = plugin[key]

def verify_package_integrity(plugin: dict, archive: str, working_directory: str) -> None:
    package = plugin['package']
    if 'integrity' not in plugin:
        raise InstallException(f'Package integrity for {package} is missing')

    integrity = plugin['integrity']
    if not isinstance(integrity, str):
        raise InstallException(f'Package integrity for {package} must be a string')

    integrity = integrity.split('-')
    if len(integrity) != 2:
        raise InstallException(f'Package integrity for {package} must be a string of the form <algorithm>-<hash>')

    algorithm = integrity[0]
    if algorithm not in RECOGNIZED_ALGORITHMS:
        raise InstallException(f'{package}: Provided Package integrity algorithm {algorithm} is not supported, please use one of following algorithms {RECOGNIZED_ALGORITHMS} instead')

    hash_digest = integrity[1]
    try:
      base64.b64decode(hash_digest, validate=True)
    except binascii.Error:
      raise InstallException(f'{package}: Provided Package integrity hash {hash_digest} is not a valid base64 encoding')

    cat_process = subprocess.Popen(["cat", archive], stdout=subprocess.PIPE)
    openssl_dgst_process = subprocess.Popen(["openssl", "dgst", "-" + algorithm, "-binary"], stdin=cat_process.stdout, stdout=subprocess.PIPE)
    openssl_base64_process = subprocess.Popen(["openssl", "base64", "-A"], stdin=openssl_dgst_process.stdout, stdout=subprocess.PIPE)

    output, _ = openssl_base64_process.communicate()
    if hash_digest != output.decode('utf-8').strip():
      raise InstallException(f'{package}: The hash of the downloaded package {output.decode("utf-8").strip()} does not match the provided integrity hash {hash_digest} provided in the configuration file')

# Create the lock file, so that other instances of the script will wait for this one to finish
def create_lock(lock_file_path):
    while True:
      try:
        with open(lock_file_path, 'x'):
          print(f"======= Created lock file: {lock_file_path}")
          return
      except FileExistsError:
        wait_for_lock_release(lock_file_path)

# Remove the lock file
def remove_lock(lock_file_path):
   os.remove(lock_file_path)
   print(f"======= Removed lock file: {lock_file_path}")

# Wait for the lock file to be released
def wait_for_lock_release(lock_file_path):
   print(f"======= Waiting for lock release (file: {lock_file_path})...", flush=True)
   while True:
     if not os.path.exists(lock_file_path):
       break
     time.sleep(1)
   print("======= Lock released.")

def main():

    dynamicPluginsRoot = sys.argv[1]

    lock_file_path = os.path.join(dynamicPluginsRoot, 'install-dynamic-plugins.lock')
    atexit.register(remove_lock, lock_file_path)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))
    create_lock(lock_file_path)

    skipIntegrityCheck = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"

    dynamicPluginsFile = 'dynamic-plugins.yaml'
    dynamicPluginsGlobalConfigFile = os.path.join(dynamicPluginsRoot, 'app-config.dynamic-plugins.yaml')

    # test if file dynamic-plugins.yaml exists
    if not os.path.isfile(dynamicPluginsFile):
        print(f"No {dynamicPluginsFile} file found. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    globalConfig = {
      'dynamicPlugins': {
            'rootDirectory': 'dynamic-plugins-root'
      }
    }

    with open(dynamicPluginsFile, 'r') as file:
        content = yaml.safe_load(file)

    if content == '' or content is None:
        print(f"{dynamicPluginsFile} file is empty. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    if not isinstance(content, dict):
        raise InstallException(f"{dynamicPluginsFile} content must be a YAML object")

    allPlugins = {}

    if skipIntegrityCheck:
        print(f"SKIP_INTEGRITY_CHECK has been set to {skipIntegrityCheck}, skipping integrity check of packages")

    if 'includes' in content:
        includes = content['includes']
    else:
        includes = []

    if not isinstance(includes, list):
        raise InstallException(f"content of the \'includes\' field must be a list in {dynamicPluginsFile}")

    for include in includes:
        if not isinstance(include, str):
            raise InstallException(f"content of the \'includes\' field must be a list of strings in {dynamicPluginsFile}")

        print('\n======= Including dynamic plugins from', include, flush=True)

        if not os.path.isfile(include):
            print(f"WARNING: File {include} does not exist, skipping including dynamic packages from {include}", flush=True)
            continue

        with open(include, 'r') as file:
            includeContent = yaml.safe_load(file)

        if not isinstance(includeContent, dict):
            raise InstallException(f"{include} content must be a YAML object")

        includePlugins = includeContent['plugins']
        if not isinstance(includePlugins, list):
            raise InstallException(f"content of the \'plugins\' field must be a list in {include}")

        for plugin in includePlugins:
            mergePlugin(plugin, allPlugins, dynamicPluginsFile)

    if 'plugins' in content:
        plugins = content['plugins']
    else:
        plugins = []

    if not isinstance(plugins, list):
        raise InstallException(f"content of the \'plugins\' field must be a list in {dynamicPluginsFile}")

    for plugin in plugins:
        mergePlugin(plugin, allPlugins, dynamicPluginsFile)

    # add a hash for each plugin configuration to detect changes
    for plugin in allPlugins.values():
        hash_dict = copy.deepcopy(plugin)
        # remove elements that shouldn't be tracked for installation detection
        hash_dict.pop('pluginConfig', None)
        
        package = plugin['package']
        if package.startswith('./'):
            local_info = get_local_package_info(package)
            hash_dict['_local_package_info'] = local_info
        
        hash = hashlib.sha256(json.dumps(hash_dict, sort_keys=True).encode('utf-8')).hexdigest()
        plugin['hash'] = hash

    # create a dict of all currently installed plugins in dynamicPluginsRoot
    plugin_path_by_hash = {}
    for dir_name in os.listdir(dynamicPluginsRoot):
        dir_path = os.path.join(dynamicPluginsRoot, dir_name)
        if os.path.isdir(dir_path):
            hash_file_path = os.path.join(dir_path, 'dynamic-plugin-config.hash')
            if os.path.isfile(hash_file_path):
                with open(hash_file_path, 'r') as hash_file:
                    hash_value = hash_file.read().strip()
                    plugin_path_by_hash[hash_value] = dir_name
                    
    # iterate through the list of plugins
    for plugin in allPlugins.values():
        _, plugin_config = install_plugin(plugin, plugin_path_by_hash, dynamicPluginsRoot, skipIntegrityCheck)
        
        # Merge plugin configuration if provided
        if plugin_config:
            globalConfig = maybeMergeConfig(plugin_config, globalConfig)

    yaml.safe_dump(globalConfig, open(dynamicPluginsGlobalConfigFile, 'w'))

    # remove plugins that have been removed from the configuration
    for hash_value in plugin_path_by_hash:
        plugin_directory = os.path.join(dynamicPluginsRoot, plugin_path_by_hash[hash_value])
        print('\n======= Removing previously installed dynamic plugin', plugin_path_by_hash[hash_value], flush=True)
        shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)

main()
