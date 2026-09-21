/**
 * MCP references, kept deliberately shallow: SkillLock records which servers a
 * skill mentions, not what those servers can do. Deep MCP lock/diff is a
 * different tool's job.
 */

import { parse as parseYaml } from 'yaml';

import { confidenceFor } from '../evidence/confidence.js';
import { isNegatedContext, makeFinding } from '../evidence/evidence.js';
import { normalizeMcp } from '../manifest/normalize.js';
import type { AuthorityFinding } from '../manifest/schema.js';
import type { ScanUnit } from '../scanner/units.js';
import type { Extractor } from './types.js';

/** `mcp__github__create_issue` */
const MCP_TOOL_NAME = /\bmcp__([A-Za-z0-9][A-Za-z0-9_-]*?)__([A-Za-z0-9_-]+)/g;

/** `mcp://github/issues` */
const MCP_URI = /\bmcp:\/\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/** Config keys that register MCP servers. */
const SERVER_MAP_KEYS = new Set(['mcpservers', 'mcp_servers', 'servers']);

export const mcpExtractor: Extractor = {
  name: 'mcp',
  supports: () => true,
  extract(unit) {
    const findings: AuthorityFinding[] = [];

    const push = (raw: string, index: number, reason: string, declared = false): void => {
      const value = normalizeMcp(raw);
      if (!value) return;
      findings.push(
        makeFinding({
          unit,
          kind: 'mcp',
          value,
          confidence: confidenceFor(unit, {
            declared,
            negated: isNegatedContext(unit, index),
          }),
          reason,
          index,
        }),
      );
    };

    for (const match of unit.text.matchAll(MCP_TOOL_NAME)) {
      push(match[1] ?? '', match.index ?? 0, 'mcp-tool-name');
    }
    for (const match of unit.text.matchAll(MCP_URI)) {
      push(match[1] ?? '', match.index ?? 0, 'mcp-uri');
    }

    if (unit.language === 'json' || unit.language === 'yaml') {
      for (const server of serversFromConfig(unit)) {
        push(server.name, server.index, 'mcp-server-config', true);
      }
    }

    return findings;
  },
};

interface ConfigServer {
  name: string;
  index: number;
}

/** Find `mcpServers: { github: {...} }` in JSON or YAML config. */
function serversFromConfig(unit: ScanUnit): ConfigServer[] {
  let data: unknown;
  try {
    data = unit.language === 'json' ? JSON.parse(unit.text) : parseYaml(unit.text);
  } catch {
    return [];
  }
  const names = new Set<string>();
  collectServerNames(data, names, 0);
  return [...names].map((name) => {
    const quoted = unit.text.indexOf(`"${name}"`);
    const bare = quoted === -1 ? unit.text.indexOf(name) : quoted;
    return { name, index: Math.max(0, bare) };
  });
}

function collectServerNames(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 8 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectServerNames(entry, out, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SERVER_MAP_KEYS.has(key.toLowerCase()) && typeof child === 'object' && child !== null) {
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (typeof entry === 'object' && entry !== null) {
            const name = (entry as Record<string, unknown>)['name'];
            if (typeof name === 'string') out.add(name);
          }
        }
      } else {
        for (const name of Object.keys(child)) out.add(name);
      }
      continue;
    }
    collectServerNames(child, out, depth + 1);
  }
}
