#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dynamicPluginsDir = path.resolve(__dirname, "..");
const wrappersDir = path.join(dynamicPluginsDir, "wrappers");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [, , inputSpecifier] = process.argv;

if (!inputSpecifier) {
  fail("Usage: yarn new-wrapper <package[@version]>");
}

const packageSpecifier = inputSpecifier.trim();

function parseInfoOutput(output) {
  const lines = output.trim().split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) {
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(lines[lines.length - 1]);
  } catch (error) {
    fail(`Unable to parse npm info output: ${error.message}`);
  }

  if (parsed && typeof parsed === "object" && "type" in parsed && parsed.type === "inspect" && parsed.data) {
    return parsed.data;
  }

  return parsed;
}

let packageInfo;
try {
  const rawInfo = execFileSync(
    "yarn",
    ["npm", "info", packageSpecifier, "--json"],
    { cwd: dynamicPluginsDir, encoding: "utf8" },
  );
  packageInfo = parseInfoOutput(rawInfo);
} catch (error) {
  if (error.stdout) {
    const parsed = parseInfoOutput(error.stdout.toString());
    if (parsed) {
      packageInfo = parsed;
    }
  }
  if (!packageInfo) {
    fail(`Failed to fetch npm info for ${packageSpecifier}`);
  }
}

if (!packageInfo || typeof packageInfo !== "object") {
  fail(`Unable to resolve package info for ${packageSpecifier}`);
}

const { name: packageName, version: packageVersion, backstage = {} } = packageInfo;

if (!packageName || !packageVersion) {
  fail(`Package metadata is missing required fields for ${packageSpecifier}`);
}

if (!backstage.role) {
  fail(`Package ${packageName} does not expose a Backstage role`);
}

const role = backstage.role;
const isFrontend = role === "frontend-plugin";
const isBackend = role === "backend-plugin" || role === "backend-plugin-module";

if (!isFrontend && !isBackend) {
  fail(`Unsupported Backstage role "${role}" for ${packageName}`);
}

function sanitizePackageName(value) {
  return value.replace(/^@/, "").replace(/\//g, "-");
}

function toScalprumName(value) {
  const match = /^@([^/]+)\/(.+)$/.exec(value);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  return value.replace(/^@/, "").replace(/\//g, ".");
}

const sanitizedPackageName = sanitizePackageName(packageName);
const wrapperDirName = isBackend ? `${sanitizedPackageName}-dynamic` : sanitizedPackageName;
const wrapperDir = path.join(wrappersDir, wrapperDirName);
const wrapperPackageName = isBackend ? sanitizedPackageName : wrapperDirName;

if (fs.existsSync(wrapperDir)) {
  fail(`Wrapper directory ${wrapperDirName} already exists`);
}

fs.mkdirSync(wrapperDir, { recursive: true });
fs.mkdirSync(path.join(wrapperDir, "src"), { recursive: true });
fs.mkdirSync(path.join(wrapperDir, "dist"), { recursive: true });
fs.mkdirSync(path.join(wrapperDir, ".turbo"), { recursive: true });

if (isFrontend) {
  fs.mkdirSync(path.join(wrapperDir, "dist-scalprum"), { recursive: true });
} else {
  fs.mkdirSync(path.join(wrapperDir, "dist-dynamic"), { recursive: true });
}

fs.writeFileSync(
  path.join(wrapperDir, ".eslintignore"),
  "dist-dynamic\ndist-scalprum\n",
);

fs.writeFileSync(
  path.join(wrapperDir, ".eslintrc.js"),
  "module.exports = require('@backstage/cli/config/eslint-factory')(__dirname);\n",
);

const exportStatement = isFrontend
  ? `export * from '${packageName}';\n`
  : `export { default } from '${packageName}';\n`;

fs.writeFileSync(path.join(wrapperDir, "src/index.ts"), exportStatement);

const tsconfig = {
  extends: "@backstage/cli/config/tsconfig.json",
  include: ["src", "dev", "migrations"],
  exclude: ["node_modules"],
  compilerOptions: {
    outDir: `../../dist-types/wrappers/${wrapperDirName}`,
    rootDir: ".",
    declaration: true,
  },
};

fs.writeFileSync(
  path.join(wrapperDir, "tsconfig.json"),
  `${JSON.stringify(tsconfig, null, 2)}\n`,
);

const turboConfig = {
  extends: ["//"],
  tasks: {
    tsc: {
      outputs: [`../../dist-types/wrappers/${wrapperDirName}/**`],
    },
  },
};

fs.writeFileSync(
  path.join(wrapperDir, "turbo.json"),
  `${JSON.stringify(turboConfig, null, 2)}\n`,
);

const repository = {
  type: "git",
  url: "https://github.com/redhat-developer/rhdh",
  directory: `dynamic-plugins/wrappers/${wrapperDirName}`,
};

const maintainerList = ["@janus-idp/maintainers-showcase"];

const commonScripts = {
  tsc: "tsc",
  build: "backstage-cli package build",
  "lint:check": "backstage-cli package lint",
  test: "backstage-cli package test --passWithNoTests --coverage",
  clean: "backstage-cli package clean",
  "export-dynamic:clean": "run export-dynamic --clean",
};

const dependencies = {
  [packageName]: packageVersion,
};

const devDependencies = {
  "@backstage/cli": "0.30.0",
  "@janus-idp/cli": "3.6.1",
  typescript: "5.8.3",
};

const defaultFrontendSupportedVersions = "1.39.1";
const defaultBackendSupportedVersions = "1.36.1";

let packageJson;

if (isFrontend) {
  commonScripts["export-dynamic"] = "janus-cli package export-dynamic-plugin --in-place";

  const pluginPackages = Array.isArray(backstage.pluginPackages) && backstage.pluginPackages.length > 0
    ? backstage.pluginPackages.map(sanitizePackageName)
    : [wrapperDirName];

  const backstageSection = {
    role: "frontend-plugin",
    "supported-versions":
      backstage["supported-versions"] ?? defaultFrontendSupportedVersions,
    pluginId: backstage.pluginId ?? sanitizedPackageName,
    pluginPackages,
  };

  packageJson = {
    name: wrapperPackageName,
    version: packageVersion,
    main: "src/index.ts",
    types: "src/index.ts",
    sideEffects: false,
    license: "Apache-2.0",
    publishConfig: {
      access: "public",
      main: "dist/index.cjs.js",
      types: "dist/index.d.ts",
    },
    backstage: backstageSection,
    scripts: commonScripts,
    dependencies,
    devDependencies,
    files: ["dist", "dist-scalprum"],
    scalprum: {
      name: toScalprumName(packageName),
      exposedModules: {
        PluginRoot: "./src/index.ts",
      },
    },
    repository,
    maintainers: maintainerList,
    author: "Red Hat",
    homepage: "https://red.ht/rhdh",
    bugs: "https://issues.redhat.com/browse/RHIDP",
    keywords: ["support:tech-preview", "lifecycle:active"],
  };
} else {
  commonScripts["export-dynamic"] = `janus-cli package export-dynamic-plugin --embed-package ${packageName}`;
  commonScripts["clean-dynamic-sources"] = "yarn clean && rm -Rf node_modules";

  const backstageSection = {
    role,
    "supported-versions":
      backstage["supported-versions"] ?? defaultBackendSupportedVersions,
    pluginId: backstage.pluginId ?? sanitizedPackageName,
  };

  if (backstage.pluginPackage) {
    backstageSection.pluginPackage = backstage.pluginPackage;
  }

  packageJson = {
    name: wrapperPackageName,
    version: packageVersion,
    main: "src/index.ts",
    types: "src/index.ts",
    license: "Apache-2.0",
    private: true,
    publishConfig: {
      access: "public",
    },
    backstage: backstageSection,
    scripts: commonScripts,
    dependencies,
    devDependencies,
    exports: {
      ".": "./src/index.ts",
      "./package.json": "./package.json",
    },
    typesVersions: {
      "*": {
        "package.json": ["package.json"],
      },
    },
    files: ["dist", "dist-dynamic/*.*", "dist-dynamic/dist/**"],
    repository,
    maintainers: maintainerList,
    author: "Red Hat",
    homepage: "https://red.ht/rhdh",
    bugs: "https://issues.redhat.com/browse/RHIDP",
    keywords: ["support:production", "lifecycle:active"],
  };
}

fs.writeFileSync(
  path.join(wrapperDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`,
);

console.log(`Created wrapper at wrappers/${wrapperDirName}`);
