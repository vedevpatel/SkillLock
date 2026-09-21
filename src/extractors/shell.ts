/**
 * External binaries the skill appears able to invoke, normalized to the binary
 * name: `git commit -m foo` and `git push` are both `git`.
 *
 * This extractor owns command-line syntax, so it also reports the filesystem
 * authority visible in command arguments and redirections.
 */

import { confidenceFor } from '../evidence/confidence.js';
import { isNegatedContext, makeFinding } from '../evidence/evidence.js';
import { normalizeCommand } from '../manifest/normalize.js';
import { DYNAMIC, type AuthorityFinding, type AuthorityKind } from '../manifest/schema.js';
import type { ScanUnit } from '../scanner/units.js';
import { looksLikeCommandLine } from './binaries.js';
import { normalizeCommandPath, pushPath } from './filesystem.js';
import { asStringLiteral, iterateCalls, splitTopLevel } from './resolve.js';
import {
  commandText,
  isStreamTarget,
  lexShell,
  splitCommands,
  type ShellCommand,
  type ShellToken,
} from './shell-lex.js';
import type { Extractor, ExtractorOptions } from './types.js';

/** Commands whose file arguments are read. */
const READ_COMMANDS: Record<string, { directory?: boolean }> = {
  '.': {},
  base64: {},
  cat: {},
  diff: {},
  file: {},
  head: {},
  less: {},
  md5: {},
  md5sum: {},
  more: {},
  od: {},
  sha1sum: {},
  sha256sum: {},
  shasum: {},
  source: {},
  stat: {},
  strings: {},
  wc: {},
  xxd: {},
};

/** Commands whose file arguments are mutated. Deletion is grouped under write in v0. */
const WRITE_COMMANDS: Record<string, { directory?: boolean; lastArgOnly?: boolean; readOthers?: boolean }> = {
  cp: { lastArgOnly: true, readOthers: true },
  install: { lastArgOnly: true, readOthers: true },
  ln: { lastArgOnly: true },
  mkdir: { directory: true },
  mv: { lastArgOnly: true, readOthers: true },
  rm: {},
  rmdir: { directory: true },
  tee: {},
  touch: {},
  truncate: {},
};

/** Calls that hand a command line to the operating system. */
const EXEC_CALLS: Record<string, { style: 'string' | 'argv' | 'either' }> = {
  system: { style: 'string' },
  popen: { style: 'string' },
  run: { style: 'either' },
  call: { style: 'either' },
  check_call: { style: 'either' },
  check_output: { style: 'either' },
  Popen: { style: 'either' },
  getoutput: { style: 'string' },
  exec: { style: 'string' },
  execSync: { style: 'string' },
  execFile: { style: 'argv' },
  execFileSync: { style: 'argv' },
  spawn: { style: 'argv' },
  spawnSync: { style: 'argv' },
  $: { style: 'string' },
};

/** Receivers that make an `exec`/`run` call a process launch rather than something else. */
const EXEC_RECEIVERS = new Set([
  '',
  'subprocess',
  'os',
  'child_process',
  'cp',
  'execa',
  'shelljs',
  'shell',
  'sh',
  'zx',
  'Bun',
  'Deno',
]);

const SHELL_WRAPPERS = new Set(['sh', 'bash', 'zsh', 'ksh', 'dash']);

export const shellExtractor: Extractor = {
  name: 'shell',
  supports: (unit) => unit.context !== 'md-prose',
  extract(unit, options) {
    const findings: AuthorityFinding[] = [];
    const root = options?.root;

    if (unit.language === 'shell' && !unit.looseShell) {
      analyzeShellSource(findings, unit, unit.text, 0, root, 'shell-command');
    } else if (isLooseShellContext(unit)) {
      analyzeLooseLines(findings, unit, root);
    }

    if (isCodeUnit(unit)) {
      analyzeExecCalls(findings, unit, root);
    }

    return findings;
  },
};

function isCodeUnit(unit: ScanUnit): boolean {
  return (
    unit.language === 'python' || unit.language === 'javascript' || unit.language === 'typescript'
  );
}

function isLooseShellContext(unit: ScanUnit): boolean {
  if (unit.context === 'md-inline') return true;
  if (unit.context === 'md-code') return unit.language === 'shell' || unit.language === 'other';
  return false;
}

/** Full shell parse: every command counts. */
function analyzeShellSource(
  findings: AuthorityFinding[],
  unit: ScanUnit,
  text: string,
  baseIndex: number,
  root: string | undefined,
  reason: string,
  fixedIndex?: number,
): void {
  const commands = splitCommands(lexShell(text));
  for (const command of commands) {
    analyzeCommand(findings, unit, command, baseIndex, root, reason, fixedIndex);
  }
}

/**
 * Conservative parse for unlabelled fences and inline code: the line must start
 * with a binary SkillLock recognizes, otherwise it is treated as prose.
 */
function analyzeLooseLines(findings: AuthorityFinding[], unit: ScanUnit, root: string | undefined): void {
  let offset = 0;
  for (const line of unit.text.split('\n')) {
    if (looksLikeCommandLine(line)) {
      analyzeShellSource(findings, unit, line, offset, root, 'markdown-command');
    }
    offset += line.length + 1;
  }
}

function analyzeCommand(
  findings: AuthorityFinding[],
  unit: ScanUnit,
  command: ShellCommand,
  baseIndex: number,
  root: string | undefined,
  reason: string,
  fixedIndex?: number,
): void {
  const words = command.words;
  const positionOf = (token: ShellToken): number => fixedIndex ?? baseIndex + token.index;
  const commandIndex = fixedIndex ?? baseIndex + command.index;

  // Redirection targets are writes regardless of which binary ran.
  for (const target of command.writes) {
    recordPath(findings, unit, 'filesystem.write', target, positionOf(target), root, 'shell-redirect');
  }
  for (const target of command.reads) {
    recordPath(findings, unit, 'filesystem.read', target, positionOf(target), root, 'shell-redirect');
  }

  if (words.length === 0) return;

  const binary = normalizeCommand(commandText(command));
  if (!binary) return;

  findings.push(
    makeFinding({
      unit,
      kind: 'shell',
      value: binary,
      confidence: confidenceFor(unit, { negated: isNegatedContext(unit, commandIndex) }),
      reason,
      index: commandIndex,
      ...(fixedIndex !== undefined ? { snippet: commandText(command) } : {}),
    }),
  );

  const argsStart = findBinaryTokenIndex(words, binary);
  const args = words.slice(argsStart + 1);

  // `bash -c "curl https://example.com"` hides a whole command line in an argument.
  if (SHELL_WRAPPERS.has(binary)) {
    const flagIndex = args.findIndex((token) => token.value === '-c');
    const inner = args[flagIndex + 1];
    if (flagIndex !== -1 && inner && inner.quoted) {
      analyzeShellSource(findings, unit, inner.value, 0, root, 'shell-c-command', positionOf(inner));
      return;
    }
  }

  const readSpec = READ_COMMANDS[binary];
  const writeSpec = WRITE_COMMANDS[binary];
  if (!readSpec && !writeSpec) return;

  const operands = args.filter((token) => !isFlag(token));
  if (operands.length === 0) return;

  if (readSpec) {
    for (const token of operands) {
      recordPath(findings, unit, 'filesystem.read', token, positionOf(token), root, `${binary}-arg`, readSpec.directory);
    }
    return;
  }
  if (!writeSpec) return;

  if (writeSpec.lastArgOnly) {
    const destination = operands[operands.length - 1]!;
    recordPath(findings, unit, 'filesystem.write', destination, positionOf(destination), root, `${binary}-dest`);
    if (writeSpec.readOthers) {
      for (const token of operands.slice(0, -1)) {
        recordPath(findings, unit, 'filesystem.read', token, positionOf(token), root, `${binary}-src`);
      }
    }
    return;
  }

  for (const token of operands) {
    recordPath(
      findings,
      unit,
      'filesystem.write',
      token,
      positionOf(token),
      root,
      `${binary}-arg`,
      writeSpec.directory,
    );
  }
}

function isFlag(token: ShellToken): boolean {
  return !token.quoted && token.value.startsWith('-') && token.value !== '-';
}

function recordPath(
  findings: AuthorityFinding[],
  unit: ScanUnit,
  kind: AuthorityKind,
  token: ShellToken,
  index: number,
  root: string | undefined,
  reason: string,
  directory = false,
): void {
  if (isStreamTarget(token.value)) return;
  if (!token.quoted && token.value.includes('$')) {
    pushPath(findings, {
      unit,
      kind,
      raw: DYNAMIC,
      dynamic: true,
      directory: false,
      index,
      reason: `dynamic-${reason}`,
      negated: isNegatedContext(unit, index),
      ...(root !== undefined ? { root } : {}),
    });
    return;
  }
  const value = normalizeCommandPath(token.value, root);
  if (!value) return;
  pushPath(findings, {
    unit,
    kind,
    raw: value,
    dynamic: false,
    directory,
    index,
    reason,
    negated: isNegatedContext(unit, index),
    ...(root !== undefined ? { root } : {}),
  });
}

/** Locate the token that produced the normalized binary, skipping env assignments and wrappers. */
function findBinaryTokenIndex(words: readonly ShellToken[], binary: string): number {
  for (let index = 0; index < words.length; index += 1) {
    const value = words[index]!.value;
    const base = (value.split('/').pop() ?? value).replace(/\.exe$/i, '');
    if (base === binary || value === binary) return index;
  }
  return 0;
}

/* -------------------------------------------------------------------------- */
/* commands launched from code                                                */
/* -------------------------------------------------------------------------- */

function analyzeExecCalls(
  findings: AuthorityFinding[],
  unit: ScanUnit,
  root: string | undefined,
): void {
  for (const call of iterateCalls(unit.text)) {
    const spec = EXEC_CALLS[call.name];
    if (!spec) continue;
    const receiver = call.callee.slice(0, Math.max(0, call.callee.length - call.name.length - 1));
    if (!EXEC_RECEIVERS.has(receiver)) continue;

    const args = splitTopLevel(call.args, ',').map((part) => part.trim());
    const first = args[0] ?? '';
    if (!first) continue;

    // argv form: ["git", "status"] or ("npm", ["test"])
    if (first.startsWith('[') || first.startsWith('(')) {
      const inner = first.slice(1, -1);
      const elements = splitTopLevel(inner, ',').map((part) => part.trim()).filter(Boolean);
      recordArgvCommand(findings, unit, elements, call.index, root);
      continue;
    }

    const literal = asStringLiteral(first);
    if (!literal || literal.interpolated) {
      pushShellFinding(findings, unit, DYNAMIC, call.index, 'dynamic-exec-command', true);
      continue;
    }

    if (spec.style === 'argv') {
      recordArgvCommand(findings, unit, [first], call.index, root);
      continue;
    }

    analyzeShellSource(findings, unit, literal.value, 0, root, 'exec-command', call.index);
  }
}

function recordArgvCommand(
  findings: AuthorityFinding[],
  unit: ScanUnit,
  elements: readonly string[],
  index: number,
  root: string | undefined,
): void {
  const first = elements[0];
  if (!first) return;
  const literal = asStringLiteral(first);
  if (!literal || literal.interpolated) {
    pushShellFinding(findings, unit, DYNAMIC, index, 'dynamic-exec-command', true);
    return;
  }
  const binary = normalizeCommand(literal.value);
  if (!binary) return;
  pushShellFinding(findings, unit, binary, index, 'exec-argv-command', false);

  // Remaining literal elements can still name files, e.g. ["cat", "~/.ssh/id_rsa"].
  const readSpec = READ_COMMANDS[binary];
  const writeSpec = WRITE_COMMANDS[binary];
  if (!readSpec && !writeSpec) return;
  for (const element of elements.slice(1)) {
    const value = asStringLiteral(element);
    if (!value || value.interpolated) continue;
    if (value.value.startsWith('-')) continue;
    const normalized = normalizeCommandPath(value.value, root);
    if (!normalized) continue;
    pushPath(findings, {
      unit,
      kind: readSpec ? 'filesystem.read' : 'filesystem.write',
      raw: normalized,
      dynamic: false,
      directory: (readSpec?.directory ?? writeSpec?.directory) === true,
      index,
      reason: `${binary}-argv-arg`,
      negated: isNegatedContext(unit, index),
      ...(root !== undefined ? { root } : {}),
    });
  }
}

function pushShellFinding(
  findings: AuthorityFinding[],
  unit: ScanUnit,
  value: string,
  index: number,
  reason: string,
  dynamic: boolean,
): void {
  findings.push(
    makeFinding({
      unit,
      kind: 'shell',
      value,
      confidence: confidenceFor(unit, { dynamic, negated: isNegatedContext(unit, index) }),
      reason,
      index,
    }),
  );
}

export type { ExtractorOptions };
