import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import fastGlob from 'fast-glob';
import ignoreFactory from 'ignore';

import { hashText } from '../manifest/hash.js';
import { compareStrings } from '../manifest/normalize.js';
import type { ScannedFile } from '../manifest/schema.js';
import { classifyFile } from './classify-file.js';

/** File types that can carry statically visible authority. */
export const INCLUDE_GLOBS = [
  '**/*.md',
  '**/*.py',
  '**/*.js',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.ts',
  '**/*.sh',
  '**/*.bash',
  '**/*.yaml',
  '**/*.yml',
  '**/*.json',
];

/** Never scanned: build output, caches, vendored code, and lockfiles. */
export const DEFAULT_IGNORE_GLOBS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.cache/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/.mypy_cache/**',
  '**/.pytest_cache/**',
  '**/.ruff_cache/**',
  '**/coverage/**',
  '**/*.lock',
  '**/*.min.js',
  '**/*.map',
  '**/skilllock.json',
];

export const IGNORE_FILE_NAMES = ['.gitignore', '.skilllockignore'];

/** Files larger than this are not scanned; the byte budget buys determinism, not coverage. */
export const MAX_FILE_BYTES = 1024 * 1024;

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
 * Output order is sorted byte-wise so downstream stages never see host-dependent
 * directory order.
 */
export function collectFiles(options: CollectOptions): CollectResult {
  const root = options.root;
  const matches = fastGlob.sync(INCLUDE_GLOBS, {
    cwd: root,
    ignore: DEFAULT_IGNORE_GLOBS,
    onlyFiles: true,
    followSymbolicLinks: false,
    dot: true,
    unique: true,
    suppressErrors: true,
  });

  const ignoreStack = buildIgnoreStack(root);
  const files: ScannedFile[] = [];
  const skipped: CollectResult['skipped'] = [];

  for (const relative of matches.sort(compareStrings)) {
    if (isIgnored(ignoreStack, relative)) continue;

    const absolute = path.join(root, relative);
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

  return { files, skipped };
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

interface IgnoreLayer {
  /** Directory the patterns are relative to, as a skill-relative prefix ('' for root). */
  prefix: string;
  matcher: ReturnType<typeof ignoreFactory>;
}

/**
 * Gather `.gitignore` / `.skilllockignore` files at every depth and apply each
 * one relative to its own directory, the way git does.
 */
function buildIgnoreStack(root: string): IgnoreLayer[] {
  const layers: IgnoreLayer[] = [];
  const walk = (directory: string, prefix: string, depth: number): void => {
    if (depth > 24) return;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const patterns: string[] = [];
    for (const name of IGNORE_FILE_NAMES) {
      if (!entries.some((entry) => entry.isFile() && entry.name === name)) continue;
      try {
        patterns.push(readFileSync(path.join(directory, name), 'utf8'));
      } catch {
        // An unreadable ignore file is treated as absent.
      }
    }
    if (patterns.length > 0) {
      layers.push({ prefix, matcher: ignoreFactory().add(patterns.join('\n')) });
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(directory, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1);
    }
  };
  walk(root, '', 0);
  return layers;
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'coverage',
]);

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
