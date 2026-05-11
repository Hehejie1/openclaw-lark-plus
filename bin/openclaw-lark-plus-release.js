#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, '../scripts/publish-helper.mjs');
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [scriptPath, ...args], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
