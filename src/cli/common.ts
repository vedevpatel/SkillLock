import { existsSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import colors from 'picocolors';

import { SKILL_FILE } from '../scanner/scan.js';

/** 0 pass, 1 scanner/runtime error, 2 authority drift requires review. */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_DRIFT = 2;

export class CliError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    if (hint !== undefined) this.hint = hint;
  }
}

export function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${colors.red('✗')} ${message}\n`);
  if (error instanceof CliError && error.hint) {
    process.stderr.write(`  ${colors.dim(error.hint)}\n`);
  }
}

/**
 * Resolve and sanity-check the target directory. v0 locks one skill at a time,
 * so a directory of skills is rejected with a pointer at the skills inside it.
 */
export function resolveSkillDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  if (!existsSync(resolved)) {
    throw new CliError(`No such directory: ${directory}`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new CliError(`Not a directory: ${directory}`, 'Point SkillLock at a skill directory.');
  }
  if (!existsSync(path.join(resolved, SKILL_FILE))) {
    const nested = nestedSkills(resolved);
    if (nested.length > 0) {
      throw new CliError(
        `${directory} contains ${nested.length} skills rather than one.`,
        `SkillLock v0 locks one skill at a time. Try: ${nested
          .slice(0, 3)
          .map((name) => `skilllock init ${path.join(directory, name)}`)
          .join('  ')}`,
      );
    }
  }
  return resolved;
}

function nestedSkills(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, SKILL_FILE)))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Path shown to the user: relative when that is shorter, absolute otherwise. */
export function displayPath(target: string): string {
  const relative = path.relative(process.cwd(), target);
  if (!relative || relative.startsWith('..')) return target;
  return relative;
}

export function writeOut(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}
