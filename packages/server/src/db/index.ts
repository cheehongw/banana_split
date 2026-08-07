import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

// Resolve the DB path relative to the repo root, so it's the SAME file whether
// launched from the repo root (drizzle-kit) or packages/server (npm -w).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const raw = process.env.DATABASE_URL ?? 'data/banana-split.sqlite';
// ':memory:' is a better-sqlite3 sentinel for an in-memory DB (used by tests) —
// pass it through untouched; otherwise resolve relative paths against the repo root.
const inMemory = raw === ':memory:';
const dbPath = inMemory ? raw : isAbsolute(raw) ? raw : resolve(repoRoot, raw);
if (!inMemory) mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// better-sqlite3 is synchronous: drizzle queries run with .all()/.get()/.run().
export const db = drizzle(sqlite, { schema });
export { schema };
