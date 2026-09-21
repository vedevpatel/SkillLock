import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import colors from 'picocolors';

import { diffAuthority } from '../diff/diff-authority.js';
import { renderEntryLine, renderInitSummary } from '../diff/render-diff.js';
import { parseManifest, serializeManifest } from '../manifest/serialize.js';
import { lockfilePath, scanSkill } from '../scanner/scan.js';
import { EXIT_OK, displayPath, resolveSkillDirectory, writeOut } from './common.js';

export interface InitOptions {
  directory: string;
  lockfile?: string;
  json?: boolean;
}

/** Scan a directory and write a deterministic skilllock.json. */
export function runInit(options: InitOptions): number {
  const root = resolveSkillDirectory(options.directory);
  const target = lockfilePath(root, options.lockfile);
  const result = scanSkill({ directory: root });

  const existed = existsSync(target);
  let previous = null;
  if (existed) {
    try {
      previous = parseManifest(readFileSync(target, 'utf8'), displayPath(target));
    } catch {
      previous = null; // an unreadable lockfile is simply replaced
    }
  }

  writeFileSync(target, serializeManifest(result.manifest), 'utf8');

  if (options.json) {
    writeOut(serializeManifest(result.manifest).trimEnd());
    return EXIT_OK;
  }

  writeOut(
    renderInitSummary(
      result.manifest.skill.name,
      result.files.length,
      result.manifest.authority,
      displayPath(target),
      existed,
    ),
  );

  if (previous) {
    const diff = diffAuthority(previous.authority, result.manifest.authority);
    if (diff.added.length > 0 || diff.removed.length > 0) {
      const lines = [colors.dim('Authority recorded in the previous lockfile changed:'), ''];
      for (const entry of diff.added) lines.push(renderEntryLine(entry, '+'));
      for (const entry of diff.removed) lines.push(renderEntryLine(entry, '-'));
      lines.push('');
      writeOut(lines.join('\n'));
    }
  }

  for (const skipped of result.skipped) {
    writeOut(colors.dim(`  skipped ${skipped.path} (${skipped.reason})`));
  }

  if (!result.hasSkillFile) {
    writeOut(colors.yellow(`  note: no SKILL.md in ${displayPath(root)}`));
  }

  return EXIT_OK;
}
