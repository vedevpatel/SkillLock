/**
 * Agent tools, from two sources: the `allowed-tools` frontmatter declaration
 * (structured, high confidence) and recognizable tool names in the body (lower
 * confidence, and only when the text marks them as tools).
 */

import { parse as parseYaml } from 'yaml';

import { confidenceFor } from '../evidence/confidence.js';
import { isNegatedContext, makeFinding } from '../evidence/evidence.js';
import { normalizeTool } from '../manifest/normalize.js';
import type { AuthorityFinding } from '../manifest/schema.js';
import { ALLOWED_TOOLS_KEYS, parseAllowedTools } from '../scanner/skill-md.js';
import type { ScanUnit } from '../scanner/units.js';
import type { Extractor } from './types.js';

/** Tool names SkillLock recognizes in free text. */
const AGENT_TOOLS = [
  'AskUserQuestion',
  'Bash',
  'BashOutput',
  'Browser',
  'Computer',
  'Edit',
  'Glob',
  'Grep',
  'KillShell',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'SlashCommand',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
];

const TOOL_ALTERNATION = AGENT_TOOLS.join('|');

/** `Use WebFetch to ...`, `call the Read tool`, `via Bash(git:*)`. */
const IMPERATIVE_TOOL = new RegExp(
  String.raw`\b(?:[Uu]se|[Uu]ses|[Uu]sing|[Cc]all|[Cc]alls|[Ii]nvoke|[Ii]nvokes|[Pp]refer|[Vv]ia|[Ww]ith)\s+(?:the\s+)?(${TOOL_ALTERNATION})(\([^()\n]*\))?\b`,
  'g',
);

/** `the Read tool`, `WebFetch tool` */
const NAMED_TOOL = new RegExp(String.raw`\b(${TOOL_ALTERNATION})(\([^()\n]*\))?\s+tool\b`, 'g');

/** A scoped invocation such as `Bash(git:*)` is unambiguous wherever it appears. */
const SCOPED_TOOL = new RegExp(String.raw`\b(${TOOL_ALTERNATION})\(([^()\n]*)\)`, 'g');

const EXACT_TOOL = new RegExp(String.raw`^(${TOOL_ALTERNATION})(\([^()\n]*\))?$`);

export const toolsExtractor: Extractor = {
  name: 'tools',
  supports: (unit) => unit.context !== 'source' || unit.language === 'yaml' || unit.language === 'json',
  extract(unit) {
    const findings: AuthorityFinding[] = [];

    if (unit.context === 'frontmatter') {
      findings.push(...extractDeclared(unit));
      return findings;
    }

    const push = (raw: string, index: number, reason: string): void => {
      const value = normalizeTool(raw);
      if (!value) return;
      if (value.startsWith('mcp__')) return; // recorded as an MCP reference instead
      findings.push(
        makeFinding({
          unit,
          kind: 'tool',
          value,
          confidence: confidenceFor(unit, { negated: isNegatedContext(unit, index) }),
          reason,
          index,
        }),
      );
    };

    // An inline code span that is exactly a tool name.
    if (unit.context === 'md-inline') {
      const exact = EXACT_TOOL.exec(unit.text.trim());
      if (exact) {
        push(unit.text.trim(), 0, 'inline-tool-reference');
        return findings;
      }
    }

    for (const match of unit.text.matchAll(SCOPED_TOOL)) {
      push(`${match[1]}(${match[2]})`, match.index ?? 0, 'scoped-tool-reference');
    }
    for (const match of unit.text.matchAll(IMPERATIVE_TOOL)) {
      push(`${match[1]}${match[2] ?? ''}`, match.index ?? 0, 'imperative-tool-reference');
    }
    for (const match of unit.text.matchAll(NAMED_TOOL)) {
      push(`${match[1]}${match[2] ?? ''}`, match.index ?? 0, 'named-tool-reference');
    }

    return findings;
  },
};

/** `allowed-tools: Bash(git:*) Bash(jq:*) Read` */
function extractDeclared(unit: ScanUnit): AuthorityFinding[] {
  let data: unknown;
  try {
    data = parseYaml(unit.text);
  } catch {
    return [];
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];

  const findings: AuthorityFinding[] = [];
  const record = data as Record<string, unknown>;
  for (const key of ALLOWED_TOOLS_KEYS) {
    if (!(key in record)) continue;
    const keyIndex = unit.text.indexOf(key);
    for (const tool of parseAllowedTools(record[key])) {
      if (tool.startsWith('mcp__')) continue;
      findings.push(
        makeFinding({
          unit,
          kind: 'tool',
          value: tool,
          confidence: confidenceFor(unit, { declared: true }),
          reason: 'allowed-tools-declaration',
          index: keyIndex === -1 ? 0 : keyIndex,
        }),
      );
    }
  }
  return findings;
}
