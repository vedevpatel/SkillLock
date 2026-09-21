/**
 * directory -> collect files -> hash -> parse SKILL.md -> run extractors ->
 * normalize -> dedupe -> sort -> manifest.
 *
 * Nothing in this pipeline reads the clock, the environment, or anything outside
 * the skill directory, which is what makes the output reproducible.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { EXTRACTORS } from '../extractors/index.js';
import { buildAuthority } from '../manifest/build.js';
import { aggregateHash } from '../manifest/hash.js';
import {
  SCHEMA_VERSION,
  SKILL_ROOT_PLACEHOLDER,
  type AuthorityFinding,
  type Manifest,
  type ScannedFile,
} from '../manifest/schema.js';
import { collectFiles, type CollectResult } from './collect-files.js';
import { parseSkillMarkdown } from './skill-md.js';
import { buildScanUnits, type ScanUnit } from './units.js';

export const SKILL_FILE = 'SKILL.md';
export const LOCKFILE_NAME = 'skilllock.json';

export interface ScanResult {
  manifest: Manifest;
  files: ScannedFile[];
  units: ScanUnit[];
  findings: AuthorityFinding[];
  skipped: CollectResult['skipped'];
  /** Absolute skill root. */
  root: string;
  /** False when the directory has no SKILL.md. */
  hasSkillFile: boolean;
}

export interface ScanOptions {
  /** Directory to scan; relative paths resolve against the process cwd. */
  directory: string;
}

export function scanSkill(options: ScanOptions): ScanResult {
  const root = path.resolve(options.directory);
  const { files, skipped } = collectFiles({ root });

  const units: ScanUnit[] = [];
  for (const file of files) units.push(...buildScanUnits(file));

  const findings: AuthorityFinding[] = [];
  for (const unit of units) {
    for (const extractor of EXTRACTORS) {
      if (!extractor.supports(unit)) continue;
      findings.push(...extractor.extract(unit, { root }));
    }
  }

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    skill: {
      name: skillName(root, files),
      root: SKILL_ROOT_PLACEHOLDER,
    },
    content: {
      hash: aggregateHash(files),
      files: Object.fromEntries(files.map((file) => [file.path, file.sha256])),
    },
    authority: buildAuthority(findings),
  };

  return {
    manifest,
    files,
    units,
    findings,
    skipped,
    root,
    hasSkillFile: files.some((file) => file.path === SKILL_FILE),
  };
}

/** The declared skill name, falling back to the directory name. */
function skillName(root: string, files: readonly ScannedFile[]): string {
  const skillFile = files.find((file) => file.path === SKILL_FILE);
  if (skillFile) {
    const { frontmatter } = parseSkillMarkdown(skillFile.content);
    const declared = frontmatter?.data['name'];
    if (typeof declared === 'string' && declared.trim()) return declared.trim();
  }
  return path.basename(root) || 'skill';
}

/** Absolute path of the lockfile for a skill directory. */
export function lockfilePath(directory: string, override?: string): string {
  if (override) return path.resolve(override);
  return path.join(path.resolve(directory), LOCKFILE_NAME);
}

export function directoryExists(directory: string): boolean {
  return existsSync(path.resolve(directory));
}
