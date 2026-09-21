import { existsSync, readFileSync } from 'node:fs';

import {
  diffAuthority,
  gatedEntries,
  informationalEntries,
  type GateOptions,
} from '../diff/diff-authority.js';
import { renderDiff, renderNoDrift } from '../diff/render-diff.js';
import { parseManifest } from '../manifest/serialize.js';
import { lockfilePath, scanSkill } from '../scanner/scan.js';
import { CliError, EXIT_DRIFT, EXIT_OK, displayPath, resolveSkillDirectory, writeOut } from './common.js';

export interface VerifyOptions {
  directory: string;
  lockfile?: string;
  strict?: boolean;
  json?: boolean;
}

/** Re-scan, compare against the lockfile, and fail on authority expansion. */
export function runVerify(options: VerifyOptions): number {
  const root = resolveSkillDirectory(options.directory);
  const target = lockfilePath(root, options.lockfile);

  if (!existsSync(target)) {
    throw new CliError(
      `No lockfile at ${displayPath(target)}.`,
      `Create one with: skilllock init ${options.directory}`,
    );
  }

  const previous = parseManifest(readFileSync(target, 'utf8'), displayPath(target));
  const result = scanSkill({ directory: root });
  const diff = diffAuthority(previous.authority, result.manifest.authority);

  const gate: GateOptions = options.strict === true ? { strict: true } : {};
  const gated = gatedEntries(diff, gate);
  const informational = informationalEntries(diff, gate);
  const contentChanged = previous.content.hash !== result.manifest.content.hash;

  if (options.json) {
    writeOut(
      JSON.stringify(
        {
          skill: result.manifest.skill.name,
          drift: gated.length > 0,
          contentChanged,
          previousAuthority: diff.previousCount,
          currentAuthority: diff.currentCount,
          added: gated,
          addedInformational: informational,
          removed: diff.removed,
          escalated: diff.escalated,
        },
        null,
        2,
      ),
    );
    return gated.length > 0 ? EXIT_DRIFT : EXIT_OK;
  }

  if (gated.length === 0) {
    writeOut(renderNoDrift(result.manifest.skill.name, diff, contentChanged));
    if (informational.length > 0) {
      writeOut(renderDriftFooterNote(informational.length));
    }
    return EXIT_OK;
  }

  writeOut(renderDiff(result.manifest.skill.name, gated, informational, diff));
  return EXIT_DRIFT;
}

function renderDriftFooterNote(count: number): string {
  return `  ${count} new low-confidence reference${count === 1 ? '' : 's'} (documentation only). Run with --strict to fail on these.\n`;
}
