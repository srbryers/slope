#!/usr/bin/env node
// Bump all workspace package versions to a given semver version.
// Usage: node scripts/version-bump.mjs <version>

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: node scripts/version-bump.mjs <version>');
  console.error('Example: node scripts/version-bump.mjs 1.5.0');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const packages = ['core', 'store-sqlite', 'cli', 'mcp-tools'];

for (const pkg of packages) {
  const pkgPath = join(root, 'packages', pkg, 'package.json');
  const json = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const old = json.version;
  json.version = version;
  writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\n');
  console.log(`  @slope-dev/${pkg}: ${old} → ${version}`);
}

console.log(`\nAll packages bumped to ${version}.`);
