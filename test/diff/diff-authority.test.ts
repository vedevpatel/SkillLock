import { describe, expect, it } from 'vitest';

import {
  diffAuthority,
  gatedEntries,
  informationalEntries,
  isExpansion,
} from '../../src/diff/diff-authority.js';
import { buildAuthority } from '../../src/manifest/build.js';
import type { AuthorityFinding, AuthorityKind, Confidence } from '../../src/manifest/schema.js';

function model(entries: Array<[AuthorityKind, string, Confidence?]>) {
  const findings: AuthorityFinding[] = entries.map(([kind, value, confidence]) => ({
    kind,
    value,
    confidence: confidence ?? 'high',
    evidence: { file: 'a.py', line: 1, reason: 'test' },
  }));
  return buildAuthority(findings);
}

describe('diffAuthority', () => {
  it('computes added, removed and unchanged as sets', () => {
    const before = model([
      ['network', 'api.weather.gov'],
      ['shell', 'python'],
    ]);
    const after = model([
      ['network', 'api.weather.gov'],
      ['network', 'collector.example'],
      ['filesystem.read', '~/.ssh/id_rsa'],
    ]);
    const diff = diffAuthority(before, after);
    expect(diff.added.map((e) => e.value)).toEqual(['collector.example', '~/.ssh/id_rsa']);
    expect(diff.removed.map((e) => e.value)).toEqual(['python']);
    expect(diff.unchanged.map((e) => e.value)).toEqual(['api.weather.gov']);
    expect(diff.previousCount).toBe(2);
    expect(diff.currentCount).toBe(3);
  });

  it('passes when content changed but authority did not', () => {
    const before = model([['network', 'api.weather.gov']]);
    const after = model([['network', 'api.weather.gov']]);
    const diff = diffAuthority(before, after);
    expect(diff.added).toEqual([]);
    expect(isExpansion(diff)).toBe(false);
  });

  it('does not treat removed authority as expansion', () => {
    const diff = diffAuthority(model([['shell', 'curl']]), model([]));
    expect(isExpansion(diff)).toBe(false);
    expect(diff.removed.map((e) => e.value)).toEqual(['curl']);
  });

  it('orders entries by kind then value, independent of input order', () => {
    const after = model([
      ['shell', 'curl'],
      ['network', 'b.example'],
      ['network', 'a.example'],
    ]);
    const diff = diffAuthority(model([]), after);
    expect(diff.added.map((e) => `${e.kind} ${e.value}`)).toEqual([
      'network a.example',
      'network b.example',
      'shell curl',
    ]);
  });

  it('fails on a new runtime-computed reference', () => {
    const diff = diffAuthority(model([]), model([['network', '<dynamic>', 'unknown']]));
    expect(isExpansion(diff)).toBe(true);
  });

  it('does not fail on a new documentation-only reference by default', () => {
    const diff = diffAuthority(model([]), model([['shell', 'rm', 'low']]));
    expect(isExpansion(diff)).toBe(false);
    expect(informationalEntries(diff).map((e) => e.value)).toEqual(['rm']);
    expect(isExpansion(diff, { strict: true })).toBe(true);
  });

  it('flags authority that moved from documentation into real code', () => {
    const before = model([['shell', 'curl', 'low']]);
    const after = model([['shell', 'curl', 'high']]);
    const diff = diffAuthority(before, after);
    expect(diff.escalated).toHaveLength(1);
    expect(diff.escalated[0]?.previousConfidence).toBe('low');
    expect(isExpansion(diff)).toBe(true);
  });

  it('does not flag an escalation that stays inside the failing band', () => {
    const diff = diffAuthority(model([['shell', 'curl', 'high']]), model([['shell', 'curl', 'medium']]));
    expect(isExpansion(diff)).toBe(false);
  });

  it('reports the same value under two kinds separately', () => {
    const before = model([['filesystem.read', './x']]);
    const after = model([
      ['filesystem.read', './x'],
      ['filesystem.write', './x'],
    ]);
    const diff = diffAuthority(before, after);
    expect(gatedEntries(diff).map((e) => e.kind)).toEqual(['filesystem.write']);
  });
});
