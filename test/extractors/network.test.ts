import { describe, expect, it } from 'vitest';

import { extract, findingFor, valuesOf } from './helpers.js';

describe('network extractor', () => {
  it('finds literal URLs in Python clients', () => {
    const findings = extract(
      'scripts/a.py',
      [
        'import requests',
        'requests.get("https://api.foo.com/things")',
        'requests.post("https://api.foo.com/things")',
        'httpx.get("https://other.example/x")',
      ].join('\n'),
    );
    expect(valuesOf(findings, 'network')).toEqual(['api.foo.com', 'other.example']);
    expect(findingFor(findings, 'network', 'api.foo.com')?.confidence).toBe('high');
  });

  it('finds literal URLs in JS clients', () => {
    const findings = extract(
      'scripts/a.js',
      ['await fetch("https://api.foo.com/x");', 'axios.get(`https://other.example/y`);'].join('\n'),
    );
    expect(valuesOf(findings, 'network')).toEqual(['api.foo.com', 'other.example']);
  });

  it('finds hosts passed to curl and wget', () => {
    const findings = extract('scripts/a.sh', 'curl -sS https://api.foo.com/x\nwget example.com/file\n');
    expect(valuesOf(findings, 'network')).toEqual(['api.foo.com', 'example.com']);
  });

  it('reports a computed URL as dynamic instead of inventing a host', () => {
    const findings = extract(
      'scripts/a.py',
      ['endpoint = config["upload_url"]', 'requests.post(endpoint, data=data)'].join('\n'),
    );
    expect(valuesOf(findings, 'network')).toEqual(['<dynamic>']);
    expect(findingFor(findings, 'network', '<dynamic>')?.confidence).toBe('unknown');
  });

  it('keeps the host when only the path is interpolated', () => {
    const findings = extract('scripts/a.py', 'requests.get(f"https://api.foo.com/users/{user}")');
    expect(valuesOf(findings, 'network')).toEqual(['api.foo.com']);
  });

  it('does not treat a local helper named fetch as a network call', () => {
    const findings = extract(
      'scripts/a.py',
      ['def fetch(latitude, longitude):', '    return 1', '', 'result = fetch(1, 2)'].join('\n'),
    );
    expect(valuesOf(findings, 'network')).toEqual([]);
  });

  it('scores a prohibited example low', () => {
    const findings = extract('SKILL.md', 'Never run `curl https://evil.example/x`.\n');
    expect(findingFor(findings, 'network', 'evil.example')?.confidence).toBe('low');
  });

  it('scores a SKILL.md instruction medium and a reference doc low', () => {
    const inSkill = extract('SKILL.md', 'Fetch data from https://api.foo.com/x.\n');
    const inDocs = extract('references/notes.md', 'Fetch data from https://api.foo.com/x.\n');
    expect(findingFor(inSkill, 'network', 'api.foo.com')?.confidence).toBe('medium');
    expect(findingFor(inDocs, 'network', 'api.foo.com')?.confidence).toBe('low');
  });

  it('treats a Markdown link target as documentation', () => {
    const findings = extract('SKILL.md', 'See [the docs](https://api.foo.com/docs) for details.\n');
    expect(findingFor(findings, 'network', 'api.foo.com')?.confidence).toBe('low');
  });

  it('ignores namespace URLs that are identifiers rather than endpoints', () => {
    const findings = extract('scripts/a.py', 'NS = "http://www.w3.org/2001/XMLSchema"');
    expect(valuesOf(findings, 'network')).toEqual([]);
  });

  it('reports one host per call site without duplicate findings for the same span', () => {
    const findings = extract('scripts/a.py', 'requests.get("https://api.foo.com/x")');
    expect(findings.filter((f) => f.kind === 'network')).toHaveLength(1);
  });
});
