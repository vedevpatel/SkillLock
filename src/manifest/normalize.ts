/**
 * Normalization is what creates stable, useful diffs. Every function here is a
 * pure function of its input string (plus, for paths, the skill root) so that
 * the same skill directory always produces the same manifest.
 */

import { DYNAMIC, SKILL_ROOT_PLACEHOLDER } from './schema.js';

/**
 * Byte-wise (UTF-16 code unit) comparison. Deliberately not `localeCompare`,
 * which varies by locale and would make output machine-dependent.
 */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

const QUOTE_CHARS = new Set(['"', "'", '`']);

/** Strip matched surrounding quotes and whitespace. */
export function unquote(raw: string): string {
  let s = raw.trim();
  while (s.length >= 2) {
    const first = s[0]!;
    const last = s[s.length - 1]!;
    if (QUOTE_CHARS.has(first) && first === last) {
      s = s.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return s;
}

/** True when a token contains interpolation and so cannot be resolved statically. */
export function looksDynamic(value: string): boolean {
  return /\$\{|\$[A-Za-z(]|%[sd]\b|\{\{|\{[a-z_][a-z0-9_]*\}|<[a-z_]+>|\+\s*\w|f"|%\(/i.test(value);
}

/* -------------------------------------------------------------------------- */
/* network                                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};

/**
 * `HTTPS://API.GITHUB.COM/repos/a` -> `api.github.com`
 * `http://localhost:3000/x`        -> `localhost:3000`
 *
 * Returns `<dynamic>` when the host itself is interpolated, and `null` when the
 * input is not a usable network reference.
 */
export function normalizeUrl(raw: string): string | null {
  let value = unquote(raw);
  if (!value) return null;
  if (value === DYNAMIC) return DYNAMIC;

  // Trim punctuation picked up from prose, e.g. "see (https://x.com)."
  value = value.replace(/^[([{<'"`]+/, '').replace(/[),.;:!?'"`\]}>]+$/, '');
  if (!value) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  let host: string;
  let port = '';

  if (hasScheme) {
    const schemeEnd = value.indexOf('://');
    const scheme = value.slice(0, schemeEnd + 1).toLowerCase();
    let rest = value.slice(schemeEnd + 3);
    rest = rest.split(/[/?#\\]/)[0] ?? '';
    // Drop userinfo.
    const at = rest.lastIndexOf('@');
    if (at !== -1) rest = rest.slice(at + 1);
    if (!rest) return null;
    const parsed = splitHostPort(rest);
    host = parsed.host;
    port = parsed.port;
    if (port && DEFAULT_PORTS[scheme] === port) port = '';
  } else {
    let rest = value.split(/[/?#\\]/)[0] ?? '';
    const at = rest.lastIndexOf('@');
    if (at !== -1) rest = rest.slice(at + 1);
    if (!rest) return null;
    const parsed = splitHostPort(rest);
    host = parsed.host;
    port = parsed.port;
  }

  if (!host) return null;
  if (looksDynamic(host)) return DYNAMIC;

  host = host.toLowerCase().replace(/\.+$/, '');
  if (!host) return null;

  const isBracketedIpv6 = host.startsWith('[') && host.endsWith(']');
  if (!isBracketedIpv6) {
    // A bare host must look like a hostname or IPv4 address.
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(host)) return null;
    // Reject things that are plainly not hosts (no dot and not a known local name).
    if (!host.includes('.') && !LOCAL_HOSTS.has(host)) return null;
  }

  return port ? `${host}:${port}` : host;
}

const LOCAL_HOSTS = new Set(['localhost', 'localhost.localdomain', 'host.docker.internal']);

function splitHostPort(input: string): { host: string; port: string } {
  if (input.startsWith('[')) {
    const close = input.indexOf(']');
    if (close === -1) return { host: input, port: '' };
    const host = input.slice(0, close + 1);
    const tail = input.slice(close + 1);
    const port = tail.startsWith(':') ? tail.slice(1) : '';
    return { host, port: /^\d+$/.test(port) ? port : '' };
  }
  const colon = input.lastIndexOf(':');
  if (colon === -1) return { host: input, port: '' };
  const port = input.slice(colon + 1);
  if (!/^\d+$/.test(port)) return { host: input, port: '' };
  return { host: input.slice(0, colon), port };
}

/* -------------------------------------------------------------------------- */
/* filesystem                                                                 */
/* -------------------------------------------------------------------------- */

/** Home-directory shapes that are rewritten to `~` regardless of scanning host. */
const HOME_PREFIX_PATTERNS: RegExp[] = [
  /^\/Users\/[^/]+(?=\/|$)/,
  /^\/home\/[^/]+(?=\/|$)/,
  /^\/root(?=\/|$)/,
  /^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/,
  /^\/c\/Users\/[^/]+(?=\/|$)/,
];

const HOME_TOKENS = [
  '${HOME}',
  '$HOME',
  '%USERPROFILE%',
  '${USERPROFILE}',
  '$USERPROFILE',
];

export interface NormalizePathOptions {
  /**
   * Absolute skill root. Paths inside it collapse to `$SKILL/...` so the
   * manifest never records where the skill happened to be checked out.
   */
  root?: string;
}

/**
 * `/Users/ved/foo`            -> `~/foo`
 * `~/foo/../.ssh/id_rsa`      -> `~/.ssh/id_rsa`
 * `cache/`                    -> `./cache/**`
 * `<dynamic>`                 -> `<dynamic>`
 */
export function normalizePath(raw: string, options: NormalizePathOptions = {}): string | null {
  let value = unquote(raw);
  if (!value) return null;
  if (value === DYNAMIC) return DYNAMIC;
  if (value.startsWith(SKILL_ROOT_PLACEHOLDER) || value.startsWith('~')) {
    // Already in canonical space; fall through to cleanup below.
  } else if (looksDynamic(value)) {
    const homeToken = HOME_TOKENS.find((token) => value.startsWith(token));
    if (!homeToken) return DYNAMIC;
  }

  value = value.replace(/\\\\/g, '/').replace(/\\/g, '/');

  for (const token of HOME_TOKENS) {
    if (value === token) {
      value = '~';
      break;
    }
    if (value.startsWith(`${token}/`)) {
      value = `~${value.slice(token.length)}`;
      break;
    }
  }

  const root = options.root ? options.root.replace(/\\/g, '/').replace(/\/+$/, '') : undefined;
  if (root && (value === root || value.startsWith(`${root}/`))) {
    const tail = value.slice(root.length);
    value = tail ? `${SKILL_ROOT_PLACEHOLDER}${tail}` : SKILL_ROOT_PLACEHOLDER;
  } else {
    for (const pattern of HOME_PREFIX_PATTERNS) {
      const match = pattern.exec(value);
      if (match) {
        value = `~${value.slice(match[0].length)}`;
        break;
      }
    }
    // Strip a Windows drive letter that survived the home rewrite.
    value = value.replace(/^[A-Za-z]:\//, '/');
  }

  const trailingSlash = value.endsWith('/') && value !== '/';
  const resolved = resolveLexically(value);
  if (resolved === null) return null;
  value = resolved;

  if (trailingSlash && !value.endsWith('/**')) {
    value = `${value.replace(/\/+$/, '')}/**`;
  }

  if (!value) return null;
  if (
    !value.startsWith('/') &&
    !value.startsWith('~') &&
    !value.startsWith(SKILL_ROOT_PLACEHOLDER) &&
    value !== DYNAMIC
  ) {
    value = `./${value.replace(/^\.\//, '')}`;
  }

  if (value === './' || value === '.') return './**';
  return value;
}

/** Collapse `//`, `.` and `..` segments without touching the filesystem. */
function resolveLexically(input: string): string | null {
  const isAbsolute = input.startsWith('/');
  const prefix = input.startsWith('~')
    ? '~'
    : input.startsWith(SKILL_ROOT_PLACEHOLDER)
      ? SKILL_ROOT_PLACEHOLDER
      : '';
  let body = prefix ? input.slice(prefix.length) : input;
  body = body.replace(/^\/+/, isAbsolute && !prefix ? '/' : '');

  const segments = body.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const last = out[out.length - 1];
      if (out.length > 0 && last !== '..') {
        out.pop();
      } else if (!prefix && !isAbsolute) {
        out.push('..');
      }
      continue;
    }
    out.push(segment);
  }

  const joined = out.join('/');
  if (prefix) return joined ? `${prefix}/${joined}` : prefix;
  if (isAbsolute) return `/${joined}`;
  return joined;
}

/** Sensitive scopes are reported alongside the concrete path, never instead of it. */
const SENSITIVE_SCOPES: Array<{ prefix: string; scope: string }> = [
  { prefix: '~/.ssh/', scope: '~/.ssh/**' },
  { prefix: '~/.aws/', scope: '~/.aws/**' },
  { prefix: '~/.gnupg/', scope: '~/.gnupg/**' },
  { prefix: '~/.kube/', scope: '~/.kube/**' },
  { prefix: '~/.config/', scope: '~/.config/**' },
  { prefix: '~/.docker/', scope: '~/.docker/**' },
  { prefix: '~/.npmrc', scope: '~/.npmrc' },
  { prefix: '~/.netrc', scope: '~/.netrc' },
  { prefix: '~/.git-credentials', scope: '~/.git-credentials' },
  { prefix: '/etc/', scope: '/etc/**' },
];

/** Returns the sensitive scope a path falls under, or `null`. */
export function sensitiveScope(path: string): string | null {
  for (const { prefix, scope } of SENSITIVE_SCOPES) {
    if (path === prefix || path.startsWith(prefix)) return scope;
  }
  const base = path.split('/').pop() ?? '';
  if (base === '.env' || base.startsWith('.env.')) return '.env';
  if (/(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/.test(path)) return '~/.ssh/**';
  if (/(^|\/)credentials$/.test(path)) return path;
  return null;
}

/* -------------------------------------------------------------------------- */
/* environment                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Variables that every process already has. Recording them adds noise without
 * describing authority, so they are dropped. Documented in the README.
 */
export const UBIQUITOUS_ENV_VARS = new Set([
  'BASH_SOURCE',
  'BASH_VERSION',
  'CDPATH',
  'COLORTERM',
  'COLUMNS',
  'DISPLAY',
  'EDITOR',
  'INFOPATH',
  'LANGUAGE',
  'MANPATH',
  'PAGER',
  'PATH',
  'TERM_PROGRAM',
  'VISUAL',
  'EUID',
  'FUNCNAME',
  'HOME',
  'HOSTNAME',
  'IFS',
  'LANG',
  'LINENO',
  'LINES',
  'LOGNAME',
  'OLDPWD',
  'OPTARG',
  'OPTIND',
  'PS1',
  'PS2',
  'PS3',
  'PS4',
  'PWD',
  'RANDOM',
  'REPLY',
  'SECONDS',
  'SHELL',
  'SHLVL',
  'TERM',
  'TMPDIR',
  'TZ',
  'UID',
  'USER',
  'USERPROFILE',
]);

/** Returns the variable name, or `null` if it is not a variable worth recording. */
export function normalizeEnv(raw: string): string | null {
  const value = unquote(raw).trim();
  if (!value) return null;
  if (value === DYNAMIC) return DYNAMIC;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return null;
  if (value.length < 2) return null;
  if (UBIQUITOUS_ENV_VARS.has(value)) return null;
  if (/^(LC_|BASH_|COMP_)/.test(value)) return null;
  return value;
}

/** Names that look like they hold a credential. Descriptive only, not a verdict. */
export function isSensitiveEnvName(name: string): boolean {
  return /(^|_)(TOKEN|SECRET|SECRETS|KEY|KEYS|PASSWORD|PASSWD|PASS|CREDENTIAL|CREDENTIALS|APIKEY|PRIVATE|SESSION|AUTH)$/i.test(
    name,
  );
}

/* -------------------------------------------------------------------------- */
/* shell                                                                      */
/* -------------------------------------------------------------------------- */

/** Shell syntax and builtins: they describe control flow, not external authority. */
const SHELL_NON_BINARIES = new Set([
  '!',
  '.',
  ':',
  '[',
  '[[',
  ']]',
  'alias',
  'bg',
  'break',
  'builtin',
  'case',
  'cd',
  'command',
  'continue',
  'declare',
  'do',
  'done',
  'echo',
  'elif',
  'else',
  'esac',
  'eval',
  'exec',
  'exit',
  'export',
  'false',
  'fg',
  'fi',
  'for',
  'function',
  'getopts',
  'hash',
  'help',
  'if',
  'in',
  'jobs',
  'let',
  'local',
  'logout',
  'popd',
  'printf',
  'pushd',
  'pwd',
  'read',
  'readonly',
  'return',
  'select',
  'set',
  'shift',
  'shopt',
  'source',
  'test',
  'then',
  'times',
  'trap',
  'true',
  'type',
  'typeset',
  'ulimit',
  'umask',
  'unalias',
  'unset',
  'until',
  'wait',
  'while',
]);

/** Wrapper flags that consume the next token, e.g. `sudo -u deploy cmd`. */
const WRAPPER_VALUE_FLAGS = new Set([
  '-u',
  '-g',
  '-U',
  '-C',
  '-p',
  '-I',
  '--user',
  '--group',
  '--chdir',
  '--prompt',
  '--max-args',
  '--replace',
  '--signal',
  '--kill-after',
]);

/** Wrapper commands whose interesting binary is the one they wrap. */
const COMMAND_WRAPPERS = new Set([
  'command',
  'env',
  'exec',
  'ionice',
  'nice',
  'nohup',
  'stdbuf',
  'sudo',
  'time',
  'timeout',
  'xargs',
]);

/**
 * `git commit -m hi`        -> `git`
 * `/usr/bin/python3 foo.py` -> `python3`
 * `FOO=1 sudo -u x curl ...`-> `curl`
 * `./scripts/build.sh`      -> `./scripts/build.sh`
 */
export function normalizeCommand(raw: string): string | null {
  const line = raw.trim();
  if (!line) return null;

  let tokens = line
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  // Drop a leading prompt marker from documentation snippets.
  if (tokens[0] === '$' || tokens[0] === '#' || tokens[0] === '>') tokens = tokens.slice(1);

  while (tokens.length > 0) {
    const token = tokens[0]!;
    // Leading environment assignments.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      tokens = tokens.slice(1);
      continue;
    }
    const bare = basenameOf(unquote(token));
    if (COMMAND_WRAPPERS.has(bare)) {
      tokens = tokens.slice(1);
      // Skip the wrapper's own flags, including those that take a value.
      while (tokens.length > 0 && tokens[0]!.startsWith('-')) {
        const flag = tokens[0]!;
        tokens = tokens.slice(1);
        if (WRAPPER_VALUE_FLAGS.has(flag) && tokens.length > 1) tokens = tokens.slice(1);
      }
      // `timeout 5 cmd`: the duration operand is not the binary.
      if (bare === 'timeout' && tokens.length > 1 && /^\d+(\.\d+)?[smhd]?$/i.test(tokens[0]!)) {
        tokens = tokens.slice(1);
      }
      continue;
    }
    break;
  }

  const first = tokens[0];
  if (!first) return null;

  let token = unquote(first);
  if (!token) return null;
  if (token.startsWith('-')) return null;
  if (/^[<>|&;(){}]/.test(token)) return null;
  if (token.includes('$')) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return null;

  token = token.replace(/\\/g, '/');

  // Local scripts keep their path: `./x.sh` is not the same authority as `x.sh` on PATH.
  if (token.startsWith('./') || token.startsWith('../') || token.startsWith('~/')) {
    const normalized = normalizePath(token);
    return normalized && normalized !== DYNAMIC ? normalized : null;
  }

  const binary = basenameOf(token).replace(/\.exe$/i, '');
  if (!binary) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(binary)) return null;
  if (SHELL_NON_BINARIES.has(binary)) return null;
  return binary;
}

function basenameOf(token: string): string {
  const parts = token.split('/');
  return parts[parts.length - 1] ?? token;
}

export function isShellNonBinary(token: string): boolean {
  return SHELL_NON_BINARIES.has(token);
}

/* -------------------------------------------------------------------------- */
/* agent tools and MCP                                                        */
/* -------------------------------------------------------------------------- */

/** `Bash(git:*)` keeps its argument scope; bare tool names keep their casing. */
export function normalizeTool(raw: string): string | null {
  const value = unquote(raw).trim().replace(/,$/, '');
  if (!value) return null;
  if (!/^[A-Za-z][A-Za-z0-9_.-]*(\([^()]*\))?$/.test(value)) return null;
  return value;
}

/** `mcp__github__create_issue` -> `github`; `mcp://github/x` -> `github`. */
export function normalizeMcp(raw: string): string | null {
  const value = unquote(raw).trim();
  if (!value) return null;
  if (value === DYNAMIC) return DYNAMIC;
  const server = value.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(server)) return null;
  return server;
}

/* -------------------------------------------------------------------------- */
/* snippets                                                                   */
/* -------------------------------------------------------------------------- */

const SNIPPET_MAX = 120;

/**
 * Evidence snippets are shown to humans and stored in the lockfile, so they get
 * the same absolute-path redaction as authority values.
 */
export function normalizeSnippet(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  text = redactAbsolutePaths(text);
  if (text.length > SNIPPET_MAX) text = `${text.slice(0, SNIPPET_MAX - 3).trimEnd()}...`;
  return text;
}

/** Rewrite `/Users/<name>/...`-shaped paths inside free text to `~/...`. */
export function redactAbsolutePaths(text: string): string {
  return text
    .replace(/(^|[\s"'`([{=:])\/Users\/[^/\s"'`)\]]+/g, '$1~')
    .replace(/(^|[\s"'`([{=:])\/home\/[^/\s"'`)\]]+/g, '$1~')
    .replace(/(^|[\s"'`([{=:])[A-Za-z]:\\Users\\[^\\\s"'`)\]]+/g, '$1~');
}
