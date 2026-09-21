import { createHash } from 'node:crypto';

import { compareStrings } from './normalize.js';

export const HASH_PREFIX = 'sha256:';

/** `sha256:<hex>` of the given text, encoded UTF-8. */
export function hashText(text: string): string {
  return HASH_PREFIX + createHash('sha256').update(text, 'utf8').digest('hex');
}

export function stripHashPrefix(hash: string): string {
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash;
}

/**
 * Aggregate skill hash: sha256 over `path \0 hash \n` for every file, sorted by
 * path. No timestamps, no ownership, no filesystem metadata.
 */
export function aggregateHash(files: ReadonlyArray<{ path: string; sha256: string }>): string {
  const lines = [...files]
    .sort((a, b) => compareStrings(a.path, b.path))
    .map((file) => `${file.path}\0${stripHashPrefix(file.sha256)}\n`);
  return hashText(lines.join(''));
}
