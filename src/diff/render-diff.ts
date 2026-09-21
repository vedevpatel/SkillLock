/**
 * Terminal output. A developer should understand it without reading docs, so
 * findings read as `+ reads ~/.ssh/id_rsa`, never as `SKL002 4.6 LOW`.
 */

import colors from 'picocolors';

import { isSensitiveEnvName, sensitiveScope } from '../manifest/normalize.js';
import {
  AUTHORITY_KINDS,
  authorityEntries,
  type AuthorityKind,
  type AuthorityModel,
  type Confidence,
  type Evidence,
} from '../manifest/schema.js';
import type { AuthorityDiff, DiffEntry } from './diff-authority.js';

/** Verb phrasing, chosen so the diff reads as a sentence. */
const VERBS: Record<AuthorityKind, string> = {
  network: 'contacts',
  'filesystem.read': 'reads',
  'filesystem.write': 'writes',
  environment: 'env',
  shell: 'executes',
  tool: 'uses tool',
  mcp: 'uses mcp',
};

/** Section titles for `inspect`. */
const SECTIONS: Record<AuthorityKind, string> = {
  network: 'NETWORK',
  'filesystem.read': 'FILESYSTEM READ',
  'filesystem.write': 'FILESYSTEM WRITE',
  environment: 'ENVIRONMENT',
  shell: 'SHELL',
  tool: 'TOOLS',
  mcp: 'MCP',
};

const VERB_WIDTH = Math.max(...Object.values(VERBS).map((verb) => verb.length));

export interface RenderOptions {
  /** Include the evidence line under each item. */
  evidence?: boolean;
}

export function verbFor(kind: AuthorityKind): string {
  return VERBS[kind];
}

export function sectionFor(kind: AuthorityKind): string {
  return SECTIONS[kind];
}

/** `+ reads        ~/.ssh/id_rsa   sensitive` */
export function renderEntryLine(entry: DiffEntry, sign: '+' | '-'): string {
  const verb = VERBS[entry.kind].padEnd(VERB_WIDTH);
  const color = sign === '+' ? colors.green : colors.yellow;
  const parts = [color(`  ${sign} ${verb}`), colors.bold(entry.value)];
  const tag = tagFor(entry.kind, entry.value, entry.confidence);
  if (tag) parts.push(colors.dim(tag));
  return parts.join('  ');
}

/** Sensitivity and confidence markers, never a safe/unsafe verdict. */
function tagFor(kind: AuthorityKind, value: string, confidence: Confidence): string {
  const tags: string[] = [];
  if (kind === 'environment' && isSensitiveEnvName(value)) tags.push('sensitive-name');
  if (kind === 'filesystem.read' || kind === 'filesystem.write') {
    const scope = sensitiveScope(value);
    if (scope) tags.push(`sensitive ${scope}`);
  }
  if (confidence === 'unknown') tags.push('runtime-computed');
  else if (confidence !== 'high') tags.push(confidence);
  return tags.length > 0 ? `(${tags.join(', ')})` : '';
}

export function renderEvidence(evidence: readonly Evidence[], indent = '      '): string[] {
  return evidence.map((item) => {
    const location = colors.cyan(`${item.file}:${item.line}`);
    const snippet = item.snippet ? `  ${colors.dim(item.snippet)}` : '';
    return `${indent}${location}${snippet}`;
  });
}

/** The `verify` drift report. */
export function renderDiff(
  skillName: string,
  gated: readonly DiffEntry[],
  informational: readonly DiffEntry[],
  diff: AuthorityDiff,
  options: RenderOptions = {},
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`${colors.yellow(colors.bold('⚠ AUTHORITY DRIFT'))}  ${colors.bold(skillName)}`);
  lines.push('');

  for (const entry of gated) {
    lines.push(renderEntryLine(entry, '+'));
    if (options.evidence !== false) lines.push(...renderEvidence(entry.evidence));
  }

  if (diff.removed.length > 0) {
    lines.push('');
    lines.push(colors.dim('  removed'));
    for (const entry of diff.removed) lines.push(renderEntryLine(entry, '-'));
  }

  if (informational.length > 0) {
    lines.push('');
    lines.push(colors.dim('  also new, but not treated as drift (low confidence)'));
    for (const entry of informational) lines.push(renderEntryLine(entry, '+'));
  }

  lines.push('');
  lines.push(`  Previous authority: ${diff.previousCount}`);
  lines.push(`  Current authority:  ${diff.currentCount}`);
  lines.push(`  New authority:      ${gated.length + informational.length}`);
  lines.push('');
  lines.push(colors.red(`✗ Skill gained authority.`));
  lines.push('');
  return lines.join('\n');
}

/** The `verify` success report. */
export function renderNoDrift(
  skillName: string,
  diff: AuthorityDiff,
  contentChanged: boolean,
): string {
  const lines: string[] = [];
  lines.push('');
  if (contentChanged) {
    lines.push(colors.dim(`  Content changed, authority unchanged.`));
  }
  if (diff.removed.length > 0) {
    for (const entry of diff.removed) lines.push(renderEntryLine(entry, '-'));
    lines.push('');
  }
  lines.push(
    `${colors.green('✓')} ${colors.bold(skillName)}: no authority expansion (${diff.currentCount} authority ${plural(diff.currentCount, 'item')}).`,
  );
  lines.push('');
  return lines.join('\n');
}

/** The `inspect` report. */
export function renderInspect(
  skillName: string,
  authority: AuthorityModel,
  options: { minConfidence?: Confidence } = {},
): string {
  const lines: string[] = [];
  const entries = authorityEntries(authority);
  lines.push('');
  lines.push(`${colors.bold(skillName)} ${colors.dim('— static authority references')}`);

  let shown = 0;
  for (const kind of AUTHORITY_KINDS) {
    const items = entries.filter((entry) => entry.kind === kind);
    if (items.length === 0) continue;
    lines.push('');
    lines.push(colors.bold(SECTIONS[kind]));
    lines.push('');
    for (const { item } of items) {
      shown += 1;
      const tag = tagFor(kind, item.value, item.confidence);
      lines.push(`  ${colors.bold(item.value)}${tag ? `  ${colors.dim(tag)}` : ''}`);
      lines.push(...renderEvidence(item.evidence, '    '));
    }
  }

  if (shown === 0) {
    lines.push('');
    lines.push(colors.dim('  No static authority references found.'));
  }

  lines.push('');
  lines.push(
    colors.dim(
      'SkillLock records what this skill statically references. It makes no claim about what it will do.',
    ),
  );
  lines.push('');
  return lines.join('\n');
}

/** The `init` summary. */
export function renderInitSummary(
  skillName: string,
  fileCount: number,
  authority: AuthorityModel,
  lockfileLabel: string,
  updated: boolean,
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`Scanning ${colors.bold(skillName)}...`);
  lines.push('');
  lines.push(`  ${fileCount} ${plural(fileCount, 'file')}`);
  const counts: Array<[number, string]> = [
    [authority.network.length, 'network host'],
    [authority.filesystem.read.length + authority.filesystem.write.length, 'filesystem path'],
    [authority.environment.length, 'environment variable'],
    [authority.shell.length, 'shell command'],
    [authority.tools.length, 'agent tool'],
    [authority.mcp.length, 'MCP server'],
  ];
  for (const [count, label] of counts) {
    if (count === 0) continue;
    lines.push(`  ${count} ${plural(count, label)}`);
  }
  lines.push('');
  lines.push(`${updated ? 'Updated' : 'Created'} ${colors.bold(lockfileLabel)}`);
  lines.push('');
  lines.push(`${colors.green('✓')} Commit it to git.`);
  lines.push('');
  return lines.join('\n');
}

function plural(count: number, noun: string): string {
  if (count === 1) return noun;
  if (noun.endsWith('s')) return `${noun}es`;
  return `${noun}s`;
}
