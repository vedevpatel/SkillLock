/**
 * Lightweight expression resolution. Not an AST: just enough structure to turn
 * `open(Path.home() / ".ssh/id_rsa")` into `~/.ssh/id_rsa` and to know when an
 * argument is computed at runtime and must be reported as `<dynamic>`.
 *
 * Phase 2 can swap this for real parsers without changing the manifest.
 */

import { DYNAMIC, SKILL_ROOT_PLACEHOLDER } from '../manifest/schema.js';

export interface Resolved {
  /** Resolved literal, or `<dynamic>`. */
  value: string;
  dynamic: boolean;
}

const DYNAMIC_RESULT: Resolved = { value: DYNAMIC, dynamic: true };

export interface CallSite {
  /** Full dotted callee, e.g. `fs.promises.readFile`. */
  callee: string;
  /** Final segment of the callee, e.g. `readFile`. */
  name: string;
  /** Offset of the first character of the callee. */
  index: number;
  /** Raw source between the parentheses. */
  args: string;
  /** Offset of the opening parenthesis. */
  openIndex: number;
  /** Offset just past the closing parenthesis. */
  end: number;
}

const CALL_HEAD =
  /(?<![\w$@.])([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\(/g;

/** Every `foo.bar(...)` call in a chunk of source, with balanced argument text. */
export function* iterateCalls(text: string): Generator<CallSite> {
  for (const match of text.matchAll(CALL_HEAD)) {
    const index = match.index ?? 0;
    const callee = (match[1] ?? '').replace(/\s+/g, '');
    if (!callee) continue;
    const openIndex = index + match[0].length - 1;
    const balanced = readBalanced(text, openIndex);
    if (!balanced) continue;
    const segments = callee.split('.');
    yield {
      callee,
      name: segments[segments.length - 1] ?? callee,
      index,
      args: balanced.inner,
      openIndex,
      end: balanced.end,
    };
  }
}

export interface Balanced {
  inner: string;
  /** Offset just past the closing delimiter. */
  end: number;
}

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Read a balanced bracket group starting at `openIndex`, respecting quotes. */
export function readBalanced(text: string, openIndex: number): Balanced | null {
  const open = text[openIndex];
  if (!open) return null;
  const close = CLOSERS[open];
  if (!close) return null;

  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '#' && (open === '(' || open === '[')) {
      // Python comment inside a multi-line call.
      const newline = text.indexOf('\n', index);
      if (newline === -1) break;
      index = newline;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { inner: text.slice(openIndex + 1, index), end: index + 1 };
      }
      continue;
    }
  }
  return null;
}

/** Split on `separator` at bracket/quote depth zero. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      current += char;
      if (char === '\\') {
        const next = text[index + 1];
        if (next !== undefined) {
          current += next;
          index += 1;
        }
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (depth === 0 && char === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

const STRING_LITERAL =
  /^(?:(?:[rRbBuU]|[rR][bB]|[bB][rR]|[fF]|[fF][rR]|[rR][fF])?)(?:"""([\s\S]*)"""|'''([\s\S]*)'''|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)$/;

export interface StringLiteral {
  value: string;
  /** The literal interpolates, so its value is not statically known. */
  interpolated: boolean;
}

/** Parse a single string literal (Python or JS flavour). */
export function asStringLiteral(raw: string): StringLiteral | null {
  const text = raw.trim();
  const match = STRING_LITERAL.exec(text);
  if (!match) return null;
  const body = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
  const prefix = /^[A-Za-z]+/.exec(text)?.[0]?.toLowerCase() ?? '';
  const isFString = prefix.includes('f');
  const isTemplate = text.startsWith('`');
  const interpolated =
    (isFString && /\{[^{}]*\}/.test(body)) || (isTemplate && /\$\{/.test(body)) || /%s|%d|\{\}/.test(body);
  return { value: unescape(body), interpolated };
}

function unescape(body: string): string {
  return body.replace(/\\(["'`\\nrt/])/g, (_match, char: string) => {
    switch (char) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return char;
    }
  });
}

/* -------------------------------------------------------------------------- */
/* path expressions                                                           */
/* -------------------------------------------------------------------------- */

const HOME_CALLS = new Set(['home', 'homedir', 'gethomedir']);
const CWD_CALLS = new Set(['cwd', 'getcwd']);
const JOIN_CALLS = new Set(['join', 'resolve']);
const PATH_CTORS = new Set([
  'Path',
  'PurePath',
  'PosixPath',
  'WindowsPath',
  'PurePosixPath',
  'pathlib',
]);
const DIRNAME_CALLS = new Set(['dirname']);
const BASENAME_CALLS = new Set(['basename']);
const IDENTITY_CALLS = new Set(['str', 'String', 'expanduser', 'expandvars', 'absolute', 'normpath', 'abspath', 'realpath', 'resolve_path', 'fspath']);
const HOME_ENV_NAMES = new Set(['HOME', 'USERPROFILE']);

/** Bare identifiers that stand for a known location. */
const IDENTIFIER_PATHS: Record<string, string> = {
  __file__: SKILL_ROOT_PLACEHOLDER,
  __dirname: SKILL_ROOT_PLACEHOLDER,
  __filename: SKILL_ROOT_PLACEHOLDER,
};

/**
 * Resolve a path-valued expression to a literal path, or `<dynamic>`.
 * The result is still un-normalized; callers pass it through `normalizePath`.
 */
export function resolvePathExpression(raw: string, depth = 0): Resolved {
  if (depth > 8) return DYNAMIC_RESULT;
  let text = raw.trim();
  if (!text) return DYNAMIC_RESULT;

  // Trailing keyword arguments or trailing commas from a call site.
  text = text.replace(/,\s*$/, '').trim();

  const literal = asStringLiteral(text);
  if (literal) {
    if (literal.interpolated) return DYNAMIC_RESULT;
    return { value: literal.value, dynamic: false };
  }

  if (IDENTIFIER_PATHS[text] !== undefined) {
    return { value: IDENTIFIER_PATHS[text]!, dynamic: false };
  }
  if (/^import\.meta\.(dirname|filename|url)$/.test(text)) {
    return { value: SKILL_ROOT_PLACEHOLDER, dynamic: false };
  }

  // pathlib `.parent` / `.parents[n]`
  const parent = /^(.*?)\s*\.\s*parent(?:s\s*\[\s*\d+\s*\])?$/s.exec(text);
  if (parent) {
    const base = resolvePathExpression(parent[1] ?? '', depth + 1);
    if (base.dynamic) return DYNAMIC_RESULT;
    return { value: dirnameOf(base.value), dynamic: false };
  }

  // pathlib division: Path.home() / ".ssh" / "id_rsa"
  const divided = splitTopLevel(text, '/');
  if (divided.length > 1) {
    const parts: string[] = [];
    for (const part of divided) {
      if (!part.trim()) continue;
      const resolved = resolvePathExpression(part, depth + 1);
      if (resolved.dynamic) return DYNAMIC_RESULT;
      parts.push(resolved.value);
    }
    if (parts.length === 0) return DYNAMIC_RESULT;
    return { value: joinParts(parts), dynamic: false };
  }

  // String concatenation of literals.
  const concatenated = splitTopLevel(text, '+');
  if (concatenated.length > 1) {
    const parts: string[] = [];
    for (const part of concatenated) {
      if (!part.trim()) continue;
      const resolved = resolvePathExpression(part, depth + 1);
      if (resolved.dynamic) return DYNAMIC_RESULT;
      parts.push(resolved.value);
    }
    return { value: parts.join(''), dynamic: false };
  }

  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\(/.exec(text);
  if (call) {
    const callee = (call[1] ?? '').replace(/\s+/g, '');
    const segments = callee.split('.');
    const name = segments[segments.length - 1] ?? callee;
    const balanced = readBalanced(text, call[0].length - 1);
    if (!balanced) return DYNAMIC_RESULT;
    // Anything after the call, e.g. `.read()`, is irrelevant to the path.
    const args = splitTopLevel(balanced.inner, ',')
      .map((part) => part.trim())
      .filter(Boolean);

    if (HOME_CALLS.has(name) && args.length === 0) return { value: '~', dynamic: false };
    if (CWD_CALLS.has(name) && args.length === 0) return { value: '.', dynamic: false };
    if (name === 'expanduser' && args.length === 0) return { value: '~', dynamic: false };

    if (JOIN_CALLS.has(name) || PATH_CTORS.has(name) || PATH_CTORS.has(segments[0] ?? '')) {
      if (args.length === 0) return DYNAMIC_RESULT;
      const parts: string[] = [];
      for (const arg of args) {
        if (/^[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(arg)) continue;
        const resolved = resolvePathExpression(arg, depth + 1);
        if (resolved.dynamic) return DYNAMIC_RESULT;
        parts.push(resolved.value);
      }
      if (parts.length === 0) return DYNAMIC_RESULT;
      return { value: joinParts(parts), dynamic: false };
    }

    if (DIRNAME_CALLS.has(name) && args[0]) {
      const base = resolvePathExpression(args[0], depth + 1);
      if (base.dynamic) return DYNAMIC_RESULT;
      return { value: dirnameOf(base.value), dynamic: false };
    }
    if (BASENAME_CALLS.has(name) && args[0]) {
      return resolvePathExpression(args[0], depth + 1);
    }
    if (IDENTITY_CALLS.has(name) && args[0]) {
      return resolvePathExpression(args[0], depth + 1);
    }
    if ((name === 'getenv' || name === 'environ') && args[0]) {
      const key = asStringLiteral(args[0]);
      if (key && HOME_ENV_NAMES.has(key.value)) return { value: '~', dynamic: false };
    }
    return DYNAMIC_RESULT;
  }

  // Subscript access: os.environ["HOME"]
  const subscript = /^([A-Za-z_$][A-Za-z0-9_$.]*)\s*\[\s*(.+?)\s*\]$/s.exec(text);
  if (subscript) {
    const key = asStringLiteral(subscript[2] ?? '');
    if (key && HOME_ENV_NAMES.has(key.value) && /environ$/.test(subscript[1] ?? '')) {
      return { value: '~', dynamic: false };
    }
    return DYNAMIC_RESULT;
  }

  return DYNAMIC_RESULT;
}

function joinParts(parts: readonly string[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (!out) {
      out = part;
      continue;
    }
    if (part.startsWith('/') || part.startsWith('~')) {
      // An absolute component resets the join, as os.path.join does.
      out = part;
      continue;
    }
    out = `${out.replace(/\/+$/, '')}/${part}`;
  }
  return out;
}

function dirnameOf(path: string): string {
  if (path === SKILL_ROOT_PLACEHOLDER || path === '~' || path === '.' || path === '/') return path;
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  if (slash <= 0) return trimmed.startsWith('/') ? '/' : '.';
  return trimmed.slice(0, slash);
}

/**
 * Resolve a URL-valued expression. Unlike paths, a URL built by concatenation
 * still tells us the host when the literal prefix contains it.
 */
export function resolveUrlExpression(raw: string): Resolved {
  const text = raw.trim();
  if (!text) return DYNAMIC_RESULT;

  const literal = asStringLiteral(text);
  if (literal) {
    if (!literal.interpolated) return { value: literal.value, dynamic: false };
    // `f"https://{host}/x"` hides the host; `f"https://api.foo.com/{id}"` does not.
    const beforeInterpolation = literal.value.split(/\{|\$\{|%s|%d/)[0] ?? '';
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i.test(beforeInterpolation)) {
      return { value: beforeInterpolation, dynamic: false };
    }
    return DYNAMIC_RESULT;
  }

  const concatenated = splitTopLevel(text, '+');
  if (concatenated.length > 1) {
    const first = asStringLiteral(concatenated[0] ?? '');
    if (first && /^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i.test(first.value)) {
      return { value: first.value, dynamic: false };
    }
    return DYNAMIC_RESULT;
  }

  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\(/.exec(text);
  if (call) {
    const balanced = readBalanced(text, call[0].length - 1);
    const callee = (call[1] ?? '').replace(/\s+/g, '');
    const name = callee.split('.').pop() ?? callee;
    if (balanced && (name === 'URL' || name === 'urljoin' || name === 'quote' || name === 'str')) {
      const args = splitTopLevel(balanced.inner, ',')
        .map((part) => part.trim())
        .filter(Boolean);
      // urljoin(base, path): the base carries the host.
      if (args[0]) return resolveUrlExpression(args[0]);
    }
  }

  return DYNAMIC_RESULT;
}
