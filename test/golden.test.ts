/**
 * Golden snapshots. Any change in extraction behaviour shows up as a reviewable
 * diff in these files rather than as a silent behaviour change.
 *
 * Regenerate with: npm run golden
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { serializeManifest } from '../src/manifest/serialize.js';
import { scanSkill } from '../src/scanner/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');
const GOLDEN = path.join(here, 'golden');

const FIXTURE_NAMES = [
  'weather',
  'weather-malicious',
  'docs-false-positive',
  'dynamic',
  'determinism',
];

describe('golden manifests', () => {
  for (const name of FIXTURE_NAMES) {
    it(`matches the recorded manifest for ${name}`, () => {
      const actual = serializeManifest(scanSkill({ directory: path.join(FIXTURES, name) }).manifest);
      const goldenPath = path.join(GOLDEN, `${name}.json`);

      if (process.env['UPDATE_GOLDEN'] === '1') {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(goldenPath, actual, 'utf8');
      }

      expect(existsSync(goldenPath), `missing golden file: run npm run golden`).toBe(true);
      expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
    });
  }
});

describe('determinism', () => {
  it('produces byte-identical output when scanning twice', () => {
    const directory = path.join(FIXTURES, 'determinism');
    const first = serializeManifest(scanSkill({ directory }).manifest);
    const second = serializeManifest(scanSkill({ directory }).manifest);
    expect(first).toBe(second);
  });

  it('produces the same manifest through a different path spelling', () => {
    const direct = path.join(FIXTURES, 'weather');
    const indirect = path.join(FIXTURES, 'dynamic', '..', 'weather');
    expect(serializeManifest(scanSkill({ directory: indirect }).manifest)).toBe(
      serializeManifest(scanSkill({ directory: direct }).manifest),
    );
  });

  it('never records an absolute path from the scanning host', () => {
    for (const name of FIXTURE_NAMES) {
      const text = serializeManifest(scanSkill({ directory: path.join(FIXTURES, name) }).manifest);
      expect(text).not.toContain(FIXTURES);
      expect(text).not.toMatch(/"\/Users\//);
      expect(text).not.toMatch(/"\/home\//);
    }
  });

  it('parses identical SKILL.md files identically, whatever the scan order', () => {
    // Regression: a content-keyed frontmatter cache made the second skill with
    // the same SKILL.md lose its declared name and tools.
    const weather = scanSkill({ directory: path.join(FIXTURES, 'weather') }).manifest;
    const malicious = scanSkill({ directory: path.join(FIXTURES, 'weather-malicious') }).manifest;
    expect(malicious.skill.name).toBe(weather.skill.name);
    expect(malicious.authority.tools).toEqual(weather.authority.tools);

    const reversed = [
      scanSkill({ directory: path.join(FIXTURES, 'weather-malicious') }).manifest.authority.tools,
      scanSkill({ directory: path.join(FIXTURES, 'weather') }).manifest.authority.tools,
    ];
    expect(reversed[0]).toEqual(reversed[1]);
  });

  it('respects .skilllockignore', () => {
    const result = scanSkill({ directory: path.join(FIXTURES, 'determinism') });
    const text = serializeManifest(result.manifest);
    expect(result.files.map((file) => file.path)).not.toContain('generated/ignored.py');
    expect(text).not.toContain('must-not-appear.example');
    expect(text).not.toContain('MUST_NOT_APPEAR');
    expect(text).not.toContain('/etc/shadow');
  });

  it('excludes the lockfile from the files it hashes', () => {
    const result = scanSkill({ directory: path.join(FIXTURES, 'weather') });
    expect(Object.keys(result.manifest.content.files)).not.toContain('skilllock.json');
  });
});
