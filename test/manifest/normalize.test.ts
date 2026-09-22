import { describe, expect, it } from 'vitest';

import {
  compareStrings,
  dedupe,
  isSensitiveEnvName,
  normalizeCommand,
  normalizeEnv,
  normalizeMcp,
  normalizePath,
  normalizeSnippet,
  normalizeTool,
  normalizeUrl,
  sensitiveScope,
} from '../../src/manifest/normalize.js';

describe('normalizeUrl', () => {
  it('reduces a URL to its host', () => {
    expect(normalizeUrl('https://api.github.com/repos/a')).toBe('api.github.com');
    expect(normalizeUrl('https://api.github.com/users/bar')).toBe('api.github.com');
  });

  it('lowercases the host and drops default ports', () => {
    expect(normalizeUrl('HTTPS://API.GITHUB.COM/foo')).toBe('api.github.com');
    expect(normalizeUrl('https://api.github.com:443/foo')).toBe('api.github.com');
  });

  it('keeps a non-default port', () => {
    expect(normalizeUrl('http://localhost:3000')).toBe('localhost:3000');
  });

  it('drops userinfo and trailing dots', () => {
    expect(normalizeUrl('https://user:pass@example.com/x')).toBe('example.com');
    expect(normalizeUrl('https://example.com./x')).toBe('example.com');
  });

  it('strips punctuation picked up from prose', () => {
    expect(normalizeUrl('https://example.com/docs.')).toBe('example.com');
    expect(normalizeUrl('(https://example.com/docs)')).toBe('example.com');
  });

  it('reports an interpolated host as dynamic', () => {
    expect(normalizeUrl('https://${HOST}/upload')).toBe('<dynamic>');
    expect(normalizeUrl('https://{host}/upload')).toBe('<dynamic>');
  });

  it('keeps an interpolated path, since the host is still known', () => {
    expect(normalizeUrl('https://api.foo.com/users/${id}')).toBe('api.foo.com');
  });

  it('rejects things that are not hosts', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('notahost')).toBeNull();
    expect(normalizeUrl('https:///nohost')).toBeNull();
  });

  it('accepts bare hosts and IPv6 literals', () => {
    expect(normalizeUrl('api.example.com/v1')).toBe('api.example.com');
    expect(normalizeUrl('http://[::1]:8080/x')).toBe('[::1]:8080');
  });
});

describe('normalizePath', () => {
  it('rewrites a home directory without consulting the host', () => {
    expect(normalizePath('/Users/ved/foo')).toBe('~/foo');
    expect(normalizePath('/home/ved/foo')).toBe('~/foo');
    expect(normalizePath('C:/Users/ved/foo')).toBe('~/foo');
  });

  it('resolves . and .. lexically', () => {
    expect(normalizePath('~/foo/../.ssh/id_rsa')).toBe('~/.ssh/id_rsa');
    expect(normalizePath('./a/./b/../c')).toBe('./a/c');
  });

  it('expands home tokens', () => {
    expect(normalizePath('$HOME/.aws/credentials')).toBe('~/.aws/credentials');
    expect(normalizePath('${HOME}/.aws/credentials')).toBe('~/.aws/credentials');
  });

  it('collapses a directory reference into a scope', () => {
    expect(normalizePath('./cache/')).toBe('./cache/**');
    expect(normalizePath('cache/')).toBe('./cache/**');
  });

  it('keeps relative paths relative', () => {
    expect(normalizePath('config.json')).toBe('./config.json');
    expect(normalizePath('./config.json')).toBe('./config.json');
  });

  it('rewrites paths inside the skill to $SKILL', () => {
    expect(normalizePath('/Users/ved/skills/weather/cache', { root: '/Users/ved/skills/weather' })).toBe(
      '$SKILL/cache',
    );
  });

  it('normalizes Windows separators', () => {
    expect(normalizePath('scripts\\fetch.py')).toBe('./scripts/fetch.py');
  });

  it('reports interpolated paths as dynamic', () => {
    expect(normalizePath('${OUTPUT_DIR}/report.json')).toBe('<dynamic>');
    expect(normalizePath('<dynamic>')).toBe('<dynamic>');
  });
});

describe('sensitiveScope', () => {
  it('maps a concrete path to the scope it falls under', () => {
    expect(sensitiveScope('~/.ssh/id_rsa')).toBe('~/.ssh/**');
    expect(sensitiveScope('~/.aws/credentials')).toBe('~/.aws/**');
    expect(sensitiveScope('/etc/passwd')).toBe('/etc/**');
    expect(sensitiveScope('./.env')).toBe('.env');
    expect(sensitiveScope('./.env.local')).toBe('.env');
  });

  it('returns null for ordinary paths', () => {
    expect(sensitiveScope('./cache/latest.json')).toBeNull();
  });
});

describe('normalizeCommand', () => {
  it('reduces an invocation to its binary', () => {
    expect(normalizeCommand('git commit -m hi')).toBe('git');
    expect(normalizeCommand('git status')).toBe('git');
    expect(normalizeCommand('npm install')).toBe('npm');
    expect(normalizeCommand('python foo.py')).toBe('python');
    expect(normalizeCommand('curl https://foo.com')).toBe('curl');
  });

  it('strips absolute paths and .exe suffixes', () => {
    expect(normalizeCommand('/usr/bin/python3 foo.py')).toBe('python3');
    expect(normalizeCommand('C:\\tools\\curl.exe https://x.com')).toBe('curl');
  });

  it('skips environment assignments, wrappers and prompts', () => {
    expect(normalizeCommand('FOO=1 BAR=2 curl https://x.com')).toBe('curl');
    expect(normalizeCommand('sudo -u deploy systemctl restart web')).toBe('systemctl');
    expect(normalizeCommand('timeout 30 npm test')).toBe('npm');
    expect(normalizeCommand('$ git push')).toBe('git');
  });

  it('keeps the path of a local script', () => {
    expect(normalizeCommand('./scripts/build.sh --release')).toBe('./scripts/build.sh');
  });

  it('rejects shell syntax and builtins', () => {
    expect(normalizeCommand('if')).toBeNull();
    expect(normalizeCommand('echo hello')).toBeNull();
    expect(normalizeCommand('export FOO=1')).toBeNull();
    expect(normalizeCommand('$CMD --flag')).toBeNull();
    expect(normalizeCommand('')).toBeNull();
  });
});

describe('normalizeEnv', () => {
  it('keeps the name only', () => {
    expect(normalizeEnv('ANTHROPIC_API_KEY')).toBe('ANTHROPIC_API_KEY');
    expect(normalizeEnv('"DATABASE_URL"')).toBe('DATABASE_URL');
  });

  it('drops variables every process already has', () => {
    expect(normalizeEnv('HOME')).toBeNull();
    expect(normalizeEnv('PWD')).toBeNull();
    expect(normalizeEnv('LC_ALL')).toBeNull();
  });

  it('rejects non-identifiers', () => {
    expect(normalizeEnv('1')).toBeNull();
    expect(normalizeEnv('A B')).toBeNull();
  });
});

describe('isSensitiveEnvName', () => {
  it('recognizes credential-shaped names without judging them', () => {
    expect(isSensitiveEnvName('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSensitiveEnvName('GITHUB_TOKEN')).toBe(true);
    expect(isSensitiveEnvName('DB_PASSWORD')).toBe(true);
    expect(isSensitiveEnvName('DATABASE_URL')).toBe(false);
  });
});

describe('normalizeTool and normalizeMcp', () => {
  it('keeps tool scopes intact', () => {
    expect(normalizeTool('Bash(git:*)')).toBe('Bash(git:*)');
    expect(normalizeTool('Read,')).toBe('Read');
    expect(normalizeTool('not a tool')).toBeNull();
  });

  it('lowercases MCP server names', () => {
    expect(normalizeMcp('GitHub')).toBe('github');
    expect(normalizeMcp('file system')).toBeNull();
  });
});

describe('dedupe and ordering', () => {
  it('deduplicates and sorts', () => {
    expect(dedupe(['curl', 'curl'])).toEqual(['curl']);
    expect(dedupe(['git', 'curl', 'npm', 'curl'])).toEqual(['curl', 'git', 'npm']);
  });

  it('is independent of input order', () => {
    expect(dedupe(['b', 'a', 'c'])).toEqual(dedupe(['c', 'b', 'a']));
  });

  it('sorts byte-wise rather than by locale', () => {
    // A locale-aware comparison would order these differently on some hosts.
    expect(['b', 'A', 'a', 'B'].sort(compareStrings)).toEqual(['A', 'B', 'a', 'b']);
  });
});

describe('normalizeSnippet', () => {
  it('collapses whitespace, caps length and redacts home paths', () => {
    expect(normalizeSnippet('  open(   "x"  )  ')).toBe('open( "x" )');
    expect(normalizeSnippet('cat /Users/ved/.ssh/id_rsa')).toBe('cat ~/.ssh/id_rsa');
    expect(normalizeSnippet('a'.repeat(200)).length).toBeLessThanOrEqual(120);
  });
});
