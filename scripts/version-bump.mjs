#!/usr/bin/env node
// Bump package version to a given semver version.
// Usage: node scripts/version-bump.mjs <version>

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: node scripts/version-bump.mjs <version>');
  console.error('Example: node scripts/version-bump.mjs 1.6.0');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const pkgPath = join(root, 'package.json');
const json = JSON.parse(readFileSync(pkgPath, 'utf8'));
const old = json.version;
json.version = version;
writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\n');

console.log(`  @slope-dev/slope: ${old} → ${version}`);
