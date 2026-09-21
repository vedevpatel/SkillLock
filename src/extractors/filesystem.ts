/**
 * Filesystem reads and writes, kept apart because `filesystem.read ~/.ssh/**`
 * and `filesystem.write ./cache/**` are not remotely the same authority.
 *
 * Shell command lines are handled by the shell extractor, which owns the
 * command-line syntax and emits filesystem findings from it.
 */

import { confidenceFor } from '../evidence/confidence.js';
import { isNegatedContext, makeFinding } from '../evidence/evidence.js';
import { normalizePath, sensitiveScope, unquote } from '../manifest/normalize.js';
import { DYNAMIC, type AuthorityFinding, type AuthorityKind } from '../manifest/schema.js';
import type { ScanUnit } from '../scanner/units.js';
import { asStringLiteral, iterateCalls, resolvePathExpression, splitTopLevel } from './resolve.js';
import type { Extractor, ExtractorOptions } from './types.js';

interface FsCall {
  /** Argument indexes whose path is read. */
  read?: readonly number[];
  /** Argument indexes whose path is written. */
  write?: readonly number[];
  /** Argument index of an open-mode / flags string that decides read vs write. */
  modeArg?: number;
  /** The path names a directory, so it is recorded as a `/**` scope. */
  directory?: boolean;
  /** The path is the call's receiver (`Path(...).write_text(x)`) rather than an argument. */
  receiver?: boolean;
}

/**
 * Recognized path-taking calls, keyed by the final segment of the callee.
 * Python and Node names live in one table; the names do not collide.
 */
const FS_CALLS: Record<string, FsCall> = {
  // python: builtins and os
  open: { read: [0], modeArg: 1 },
  makedirs: { write: [0], directory: true },
  mkdir: { write: [0], directory: true },
  listdir: { read: [0], directory: true },
  scandir: { read: [0], directory: true },
  walk: { read: [0], directory: true },
  remove: { write: [0] },
  unlink: { write: [0] },
  rmdir: { write: [0], directory: true },
  removedirs: { write: [0], directory: true },
  rename: { read: [0], write: [1] },
  replace: { read: [0], write: [1] },
  rmtree: { write: [0], directory: true },
  copy: { read: [0], write: [1] },
  copy2: { read: [0], write: [1] },
  copyfile: { read: [0], write: [1] },
  copytree: { read: [0], write: [1], directory: true },
  move: { read: [0], write: [1] },
  glob: { read: [0] },
  iglob: { read: [0] },
  read_text: { read: [0], receiver: true },
  read_bytes: { read: [0], receiver: true },
  write_text: { write: [0], receiver: true },
  write_bytes: { write: [0], receiver: true },
  touch: { write: [0], receiver: true },
  iterdir: { read: [0], receiver: true, directory: true },
  read_csv: { read: [0] },
  read_json: { read: [0] },
  to_csv: { write: [0] },
  to_json: { write: [0] },

  // node: fs
  readFile: { read: [0] },
  readFileSync: { read: [0] },
  createReadStream: { read: [0] },
  readdir: { read: [0], directory: true },
  readdirSync: { read: [0], directory: true },
  opendir: { read: [0], directory: true },
  opendirSync: { read: [0], directory: true },
  stat: { read: [0] },
  statSync: { read: [0] },
  lstat: { read: [0] },
  lstatSync: { read: [0] },
  access: { read: [0] },
  accessSync: { read: [0] },
  existsSync: { read: [0] },
  readlink: { read: [0] },
  readlinkSync: { read: [0] },
  realpath: { read: [0] },
  writeFile: { write: [0] },
  writeFileSync: { write: [0] },
  appendFile: { write: [0] },
  appendFileSync: { write: [0] },
  createWriteStream: { write: [0] },
  mkdirSync: { write: [0], directory: true },
  mkdtemp: { write: [0], directory: true },
  rm: { write: [0] },
  rmSync: { write: [0] },
  rmdirSync: { write: [0], directory: true },
  unlinkSync: { write: [0] },
  truncate: { write: [0] },
  truncateSync: { write: [0] },
  chmod: { write: [0] },
  chmodSync: { write: [0] },
  chown: { write: [0] },
  utimes: { write: [0] },
  copyFile: { read: [0], write: [1] },
  copyFileSync: { read: [0], write: [1] },
  cp: { read: [0], write: [1] },
  cpSync: { read: [0], write: [1] },
  renameSync: { read: [0], write: [1] },
  symlink: { write: [1] },
  symlinkSync: { write: [1] },
  link: { write: [1] },
};

/** Callees whose receiver is a path object rather than a module. */
const RECEIVER_BLOCKLIST = new Set(['self', 'this', 'os', 'fs', 'shutil', 'path', 'json', 'yaml']);

export const filesystemExtractor: Extractor = {
  name: 'filesystem',
  supports: (unit) =>
    unit.language === 'python' || unit.language === 'javascript' || unit.language === 'typescript',
  extract(unit, options) {
    const findings: AuthorityFinding[] = [];
    const root = options?.root;

    for (const call of iterateCalls(unit.text)) {
      const spec = FS_CALLS[call.name];
      if (!spec) continue;

      const args = splitTopLevel(call.args, ',').map((part) => part.trim());
      const negated = isNegatedContext(unit, call.index);

      if (spec.receiver) {
        const receiver = call.callee.slice(0, call.callee.length - call.name.length - 1);
        if (!receiver || RECEIVER_BLOCKLIST.has(receiver)) continue;
        const resolved = resolvePathExpression(receiver);
        // A dynamic receiver is usually an open file handle, not a new path.
        if (resolved.dynamic) continue;
        const kinds = spec.write ? (['filesystem.write'] as const) : (['filesystem.read'] as const);
        for (const kind of kinds) {
          pushPath(findings, {
            unit,
            kind,
            raw: resolved.value,
            dynamic: false,
            directory: spec.directory === true,
            index: call.index,
            reason: `${call.name}-receiver`,
            negated,
            ...(root !== undefined ? { root } : {}),
          });
        }
        continue;
      }

      const modes = resolveModes(spec, args);
      for (const [kind, indexes] of modes) {
        for (const argIndex of indexes) {
          const raw = args[argIndex];
          if (raw === undefined || raw === '') continue;
          if (/^[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(raw)) continue;
          const resolved = resolvePathExpression(raw);
          pushPath(findings, {
            unit,
            kind,
            raw: resolved.value,
            dynamic: resolved.dynamic,
            directory: spec.directory === true,
            index: call.index,
            reason: resolved.dynamic ? `dynamic-${call.name}-path` : `${call.name}-path`,
            negated,
            ...(root !== undefined ? { root } : {}),
          });
        }
      }
    }

    findings.push(...extractSensitiveLiterals(unit, root));
    return findings;
  },
};

/** Apply the open-mode argument, if any, to decide read vs write. */
function resolveModes(spec: FsCall, args: readonly string[]): Array<[AuthorityKind, readonly number[]]> {
  const out: Array<[AuthorityKind, readonly number[]]> = [];
  if (spec.modeArg !== undefined) {
    const pathIndexes = spec.read ?? [0];
    const mode = asStringLiteral(args[spec.modeArg] ?? '')?.value ?? '';
    const writes = /[wax+]/.test(mode);
    // An absent or unresolvable mode defaults to read, the common case.
    const reads = mode === '' || mode.includes('r') || mode.includes('+');
    if (reads) out.push(['filesystem.read', pathIndexes]);
    if (writes) out.push(['filesystem.write', pathIndexes]);
    return out;
  }
  if (spec.read) out.push(['filesystem.read', spec.read]);
  if (spec.write) out.push(['filesystem.write', spec.write]);
  return out;
}

interface PushPathInput {
  unit: ScanUnit;
  kind: AuthorityKind;
  raw: string;
  dynamic: boolean;
  directory: boolean;
  index: number;
  reason: string;
  negated: boolean;
  root?: string;
  snippet?: string;
}

/** Normalize, scope, and record one filesystem reference. */
export function pushPath(findings: AuthorityFinding[], input: PushPathInput): void {
  let value: string | null;
  if (input.dynamic) {
    value = DYNAMIC;
  } else {
    value = normalizePath(input.raw, input.root !== undefined ? { root: input.root } : {});
    if (value && input.directory && !value.endsWith('/**') && value !== DYNAMIC) {
      value = `${value.replace(/\/+$/, '')}/**`;
    }
  }
  if (!value) return;
  if (value !== DYNAMIC && !isPlausiblePath(value)) return;

  findings.push(
    makeFinding({
      unit: input.unit,
      kind: input.kind,
      value,
      confidence: confidenceFor(input.unit, {
        dynamic: input.dynamic,
        negated: input.negated,
      }),
      reason: input.reason,
      index: input.index,
      ...(input.snippet !== undefined ? { snippet: input.snippet } : {}),
    }),
  );
}

/**
 * Reject strings that normalize into something that is not a path: URLs, flags,
 * globs with no directory part, and prose.
 */
export function isPlausiblePath(value: string): boolean {
  if (!value || value === './' || value === '.' || value === './**') return false;
  if (/^\.\/[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.includes(' ')) return false;
  if (value.includes('://')) return false;
  if (/^\.\/-/.test(value)) return false;
  return true;
}

/**
 * Sensitive paths written as plain string literals, e.g. `KEY = "~/.ssh/id_rsa"`
 * followed later by `open(KEY)`. The operation is unknown, so this is recorded
 * as a read at medium confidence rather than guessed.
 */
function extractSensitiveLiterals(unit: ScanUnit, root: string | undefined): AuthorityFinding[] {
  const findings: AuthorityFinding[] = [];
  const literals = /(['"])((?:~|\/|\.\/)[^'"\n]{2,200})\1/g;
  for (const match of unit.text.matchAll(literals)) {
    const raw = match[2] ?? '';
    const index = match.index ?? 0;
    const value = normalizePath(raw, root !== undefined ? { root } : {});
    if (!value || value === DYNAMIC || !isPlausiblePath(value)) continue;
    if (!sensitiveScope(value)) continue;
    findings.push(
      makeFinding({
        unit,
        kind: 'filesystem.read',
        value,
        confidence: pickLiteralConfidence(unit, index),
        reason: 'sensitive-path-literal',
        index,
      }),
    );
  }
  return findings;
}

function pickLiteralConfidence(unit: ScanUnit, index: number): 'medium' | 'low' {
  if (isNegatedContext(unit, index)) return 'low';
  return confidenceFor(unit) === 'low' ? 'low' : 'medium';
}

/** Exported for the shell extractor, which reuses path normalization for command arguments. */
export function normalizeCommandPath(
  raw: string,
  root: string | undefined,
): string | null {
  const value = normalizePath(unquote(raw), root !== undefined ? { root } : {});
  if (!value || !isPlausiblePath(value)) return null;
  return value;
}

export type { ExtractorOptions };
