import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env into process.env BEFORE any other module reads it
// (bot.ts checks BOT_TOKEN at import time). This module is imported first in
// index.ts. tsx does not auto-load .env, so we do it ourselves — no dependency.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envPath = resolve(repoRoot, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
