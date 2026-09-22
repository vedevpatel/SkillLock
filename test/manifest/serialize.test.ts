import { describe, expect, it } from 'vitest';

import { buildAuthority } from '../../src/manifest/build.js';
import { aggregateHash, hashText } from '../../src/manifest/hash.js';
import { canonicalizeManifest, parseManifest, serializeManifest } from '../../src/manifest/serialize.js';
import {
  SCHEMA_VERSION,
  emptyAuthority,
  type AuthorityFinding,
  type Manifest,
} from '../../src/manifest/schema.js';

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    skill: { name: 'weather', root: '$SKILL' },
    content: { hash: 'sha256:abc', files: {} },
    authority: emptyAuthority(),
    ...overrides,
  };
}

describe('serializeManifest', () => {
  it('ends with exactly one newline', () => {
    const text = serializeManifest(manifest());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('writes keys in schema order regardless of construction order', () => {
    const reordered = {
      authority: emptyAuthority(),
      content: { files: { 'b.py': 'sha256:2', 'a.py': 'sha256:1' }, hash: 'sha256:abc' },
      skill: { root: '$SKILL', name: 'weather' },
      schemaVersion: SCHEMA_VERSION,
    } as Manifest;
    const text = serializeManifest(reordered);
    expect(Object.keys(JSON.parse(text))).toEqual(['schemaVersion', 'skill', 'content', 'authority']);
    // File keys are sorted, so directory order cannot leak into the lockfile.
    expect(Object.keys(JSON.parse(text).content.files)).toEqual(['a.py', 'b.py']);
  });

  it('omits empty snippets rather than writing null', () => {
    const findings: AuthorityFinding[] = [
      {
        kind: 'shell',
        value: 'git',
        confidence: 'high',
        evidence: { file: 'a.sh', line: 1, reason: 'shell-command' },
      },
    ];
    const text = serializeManifest(manifest({ authority: buildAuthority(findings) }));
    expect(text).not.toContain('snippet');
  });

  it('round-trips through parseManifest', () => {
    const original = manifest({
      authority: buildAuthority([
        {
          kind: 'network',
          value: 'api.example.com',
          confidence: 'high',
          evidence: { file: 'a.py', line: 3, reason: 'literal-url', snippet: 'x' },
        },
      ]),
    });
    const parsed = parseManifest(serializeManifest(original), 'test');
    expect(parsed).toEqual(canonicalizeManifest(original));
  });
});

describe('parseManifest', () => {
  it('rejects a newer schema version with an actionable message', () => {
    expect(() => parseManifest(JSON.stringify({ schemaVersion: 99, authority: {} }), 'lock')).toThrow(
      /schemaVersion 99/,
    );
  });

  it('rejects malformed input', () => {
    expect(() => parseManifest('{', 'lock')).toThrow(/not valid JSON/);
    expect(() => parseManifest('{}', 'lock')).toThrow(/schemaVersion/);
    expect(() => parseManifest('{"schemaVersion":1}', 'lock')).toThrow(/authority/);
  });

  it('accepts plain string authority lists for forward compatibility', () => {
    const parsed = parseManifest(
      JSON.stringify({ schemaVersion: 1, authority: { shell: ['git'] } }),
      'lock',
    );
    expect(parsed.authority.shell).toEqual([{ value: 'git', confidence: 'unknown', evidence: [] }]);
  });
});

describe('hashing', () => {
  it('prefixes hashes with the algorithm', () => {
    expect(hashText('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('aggregates independently of input order', () => {
    const files = [
      { path: 'b.py', sha256: hashText('b') },
      { path: 'a.py', sha256: hashText('a') },
    ];
    expect(aggregateHash(files)).toBe(aggregateHash([...files].reverse()));
  });

  it('changes when a path changes even if contents do not', () => {
    const a = aggregateHash([{ path: 'a.py', sha256: hashText('x') }]);
    const b = aggregateHash([{ path: 'b.py', sha256: hashText('x') }]);
    expect(a).not.toBe(b);
  });
});
