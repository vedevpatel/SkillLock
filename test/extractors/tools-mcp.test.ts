import { describe, expect, it } from 'vitest';

import { parseAllowedTools } from '../../src/scanner/skill-md.js';
import { extract, findingFor, valuesOf } from './helpers.js';

describe('parseAllowedTools', () => {
  it('splits a space separated list without breaking scopes', () => {
    expect(parseAllowedTools('Bash(git:*) Bash(jq:*) Read')).toEqual([
      'Bash(git:*)',
      'Bash(jq:*)',
      'Read',
    ]);
  });

  it('accepts a YAML list and comma separated strings', () => {
    expect(parseAllowedTools(['Bash(git:*)', 'Read'])).toEqual(['Bash(git:*)', 'Read']);
    expect(parseAllowedTools('Read, Write')).toEqual(['Read', 'Write']);
  });
});

describe('tools extractor', () => {
  const frontmatter = [
    '---',
    'name: demo',
    'allowed-tools: Bash(git:*) WebFetch Read',
    '---',
    '',
    '# Demo',
    '',
  ].join('\n');

  it('treats a declaration as high confidence', () => {
    const findings = extract('SKILL.md', frontmatter);
    expect(valuesOf(findings, 'tool')).toEqual(['Bash(git:*)', 'Read', 'WebFetch']);
    expect(findingFor(findings, 'tool', 'WebFetch')?.confidence).toBe('high');
  });

  it('treats an imperative body reference as medium confidence', () => {
    const findings = extract('SKILL.md', '# Demo\n\nUse WebFetch to retrieve the page.\n');
    expect(findingFor(findings, 'tool', 'WebFetch')?.confidence).toBe('medium');
  });

  it('recognizes a named tool reference', () => {
    const findings = extract('SKILL.md', '# Demo\n\nThe Read tool loads local files.\n');
    expect(valuesOf(findings, 'tool')).toEqual(['Read']);
  });

  it('does not treat ordinary English as a tool reference', () => {
    const findings = extract('SKILL.md', '# Demo\n\nRead the configuration and write the output.\n');
    expect(valuesOf(findings, 'tool')).toEqual([]);
  });

  it('keeps MCP tool names out of the tool list', () => {
    const findings = extract(
      'SKILL.md',
      ['---', 'allowed-tools: mcp__github__create_issue Read', '---', ''].join('\n'),
    );
    expect(valuesOf(findings, 'tool')).toEqual(['Read']);
    expect(valuesOf(findings, 'mcp')).toEqual(['github']);
  });
});

describe('mcp extractor', () => {
  it('records server names from tool identifiers and URIs', () => {
    const findings = extract(
      'SKILL.md',
      '# Demo\n\nCall mcp__github__create_issue, then read mcp://filesystem/out.\n',
    );
    expect(valuesOf(findings, 'mcp')).toEqual(['filesystem', 'github']);
  });

  it('records servers registered in JSON config', () => {
    const findings = extract(
      '.mcp.json',
      JSON.stringify({ mcpServers: { github: { command: 'npx' }, linear: { command: 'npx' } } }, null, 2),
    );
    expect(valuesOf(findings, 'mcp')).toEqual(['github', 'linear']);
    expect(findingFor(findings, 'mcp', 'github')?.confidence).toBe('high');
  });

  it('records servers registered in YAML config', () => {
    const findings = extract('config.yaml', ['mcpServers:', '  github:', '    command: npx', ''].join('\n'));
    expect(valuesOf(findings, 'mcp')).toEqual(['github']);
  });
});
