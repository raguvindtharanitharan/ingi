import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface CacheEntry {
  result: string;
  model: string;
  created_at: string;
}

export function contentHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\x00')).digest('hex');
}

export function readCache(cacheDir: string, hash: string): string | null {
  const file = path.join(cacheDir, `${hash}.json`);
  if (!existsSync(file)) return null;
  try {
    const entry = JSON.parse(readFileSync(file, 'utf-8')) as CacheEntry;
    return entry.result ?? null;
  } catch {
    return null;
  }
}

export function writeCache(cacheDir: string, hash: string, result: string, model: string): void {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${hash}.json`);
  writeFileSync(
    file,
    JSON.stringify({ result, model, created_at: new Date().toISOString() }, null, 2),
    'utf-8'
  );
}
