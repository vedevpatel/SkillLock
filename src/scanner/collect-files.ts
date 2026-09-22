import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import ignoreModule, { type Ignore, type Options as IgnoreOptions } from 'ignore';

import { hashText } from '../manifest/hash.js';
import { compareStrings } from '../manifest/normalize.js';
import type { ScannedFile } from '../manifest/schema.js';
import { classifyFile } from './classify-file.js';

/** File types that can carry statically visible authority. */
export const INCLUDE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.sh',
  '.bash',
  '.yaml',
  '.yml',
  '.json',
]);

/** Directories that are never part of a skill's authority surface. */
export const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'venv',
]);

export const LOCKFILE_BASENAME = 'skilllock.json';

export const IGNORE_FILE_NAMES = ['.gitignore', '.skilllockignore'];

/** Files larger than this are not scanned; the byte budget buys determinism, not coverage. */
export const MAX_FILE_BYTES = 1024 * 1024;

/** Generated artefacts that match an included extension but carry no authored authority. */
function isGeneratedArtifact(name: string): boolean {
  return (
    name === LOCKFILE_BASENAME ||
    name.endsWith('.lock') ||
    name.endsWith('.min.js') ||
    name.endsWith('.map')
  );
}

/** `ignore` is CJS with no `types` field, so NodeNext types the default import as the module object. */
const createIgnore = ignoreModule as unknown as (options?: IgnoreOptions) => Ignore;

export interface CollectResult {
  files: ScannedFile[];
  /** Paths skipped because they are binary, oversized, or unreadable. */
  skipped: Array<{ path: string; reason: 'binary' | 'too-large' | 'unreadable' }>;
}

export interface CollectOptions {
  /** Absolute path to the skill directory. */
  root: string;
}

/**
 * Collect the text files that make up a skill, newline-normalized and hashed.
 *
 * One recursive walk does everything: it gathers `.gitignore` /
 * `.skilllockignore` layers, applies them the way git does, and reads matching
 * files. Output is sorted byte-wise so host directory order cannot leak into the
 * manifest.
 */
export function collectFiles(options: CollectOptions): CollectResult {
  const root = options.root;
  const files: ScannedFile[] = [];
  const skipped: CollectResult['skipped'] = [];
  const layers: IgnoreLayer[] = [];

  walk(root, '', 0, layers, files, skipped);

  files.sort((a, b) => compareStrings(a.path, b.path));
  skipped.sort((a, b) => compareStrings(a.path, b.path));
  return { files, skipped };
}

interface IgnoreLayer {
  /** Directory the patterns are relative to, as a skill-relative prefix ('' for root). */
  prefix: string;
  matcher: Ignore;
}

const MAX_DEPTH = 24;

function walk(
  directory: string,
  prefix: string,
  depth: number,
  layers: IgnoreLayer[],
  files: ScannedFile[],
  skipped: CollectResult['skipped'],
): void {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  entries.sort((a, b) => compareStrings(a.name, b.name));

  // Ignore files in this directory apply to everything below it.
  const patterns: string[] = [];
  for (const name of IGNORE_FILE_NAMES) {
    if (!entries.some((entry) => entry.isFile() && entry.name === name)) continue;
    try {
      patterns.push(readFileSync(path.join(directory, name), 'utf8'));
    } catch {
      // An unreadable ignore file is treated as absent.
    }
  }
  // A copy, not a push: a sibling directory's ignore file must not affect siblings.
  const ownLayers =
    patterns.length > 0
      ? [...layers, { prefix, matcher: createIgnore().add(patterns.join('\n')) }]
      : layers;

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      if (isIgnored(ownLayers, `${relative}/`)) continue;
      walk(path.join(directory, entry.name), relative, depth + 1, ownLayers, files, skipped);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isGeneratedArtifact(entry.name)) continue;
    if (!INCLUDE_EXTENSIONS.has(extensionOf(entry.name))) continue;
    if (isIgnored(ownLayers, relative)) continue;

    const absolute = path.join(directory, entry.name);
    let buffer: Buffer;
    try {
      const stats = statSync(absolute);
      if (stats.size > MAX_FILE_BYTES) {
        skipped.push({ path: relative, reason: 'too-large' });
        continue;
      }
      buffer = readFileSync(absolute);
    } catch {
      skipped.push({ path: relative, reason: 'unreadable' });
      continue;
    }

    if (isBinary(buffer)) {
      skipped.push({ path: relative, reason: 'binary' });
      continue;
    }

    const content = normalizeText(buffer.toString('utf8'));
    files.push({
      path: relative,
      sha256: hashText(content),
      language: classifyFile(relative),
      content,
    });
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Strip a UTF-8 BOM and normalize CRLF/CR to LF before hashing, so a Windows
 * checkout of the same skill produces the same manifest.
 */
export function normalizeText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function isBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000);
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function isIgnored(layers: readonly IgnoreLayer[], relativePath: string): boolean {
  for (const layer of layers) {
    if (layer.prefix === '') {
      if (layer.matcher.ignores(relativePath)) return true;
      continue;
    }
    const prefix = `${layer.prefix}/`;
    if (!relativePath.startsWith(prefix)) continue;
    if (layer.matcher.ignores(relativePath.slice(prefix.length))) return true;
  }
  return false;
}
