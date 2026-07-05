import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Load .env so DATABASE_URL (and friends) are available to drizzle-kit.
if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DATABASE_URL ?? './data/banana-split.sqlite';
// better-sqlite3 won't create the parent directory — do it ourselves.
mkdirSync(dirname(url), { recursive: true });

export default defineConfig({
  schema: './packages/server/src/db/schema.ts',
  out: './packages/server/drizzle',
  dialect: 'sqlite',
  dbCredentials: { url },
});
