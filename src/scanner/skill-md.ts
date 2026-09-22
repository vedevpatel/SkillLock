import { parse as parseYaml } from 'yaml';

import { normalizeTool } from '../manifest/normalize.js';

export interface SkillFrontmatter {
  /** Raw YAML text between the `---` fences. */
  raw: string;
  /** 1-based line of the first YAML line. */
  startLine: number;
  data: Record<string, unknown>;
}

export interface ParsedSkillMarkdown {
  frontmatter: SkillFrontmatter | null;
  /** 1-based line where the Markdown body begins. */
  bodyStartLine: number;
}

/**
 * `---\n<yaml>\n---` at the very start of the file. Split by hand rather than
 * with a frontmatter library so that SkillLock carries one YAML parser instead
 * of two.
 */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split SKILL.md into frontmatter and body. Agent Skills are centered on this
 * file, and its frontmatter is the one place authority is *declared* rather than
 * inferred.
 */
export function parseSkillMarkdown(content: string): ParsedSkillMarkdown {
  const match = FRONTMATTER.exec(content);
  const raw = match?.[1];
  if (!match || raw === undefined || !raw.trim()) {
    return { frontmatter: null, bodyStartLine: 1 };
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(raw);
    if (isRecord(parsed)) data = parsed;
  } catch {
    // Malformed frontmatter still delimits the body; its keys are simply unknown.
  }

  return {
    frontmatter: { raw, startLine: 2, data },
    // opening fence + yaml lines + closing fence, then the first body line
    bodyStartLine: 2 + raw.split('\n').length + 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `allowed-tools: Bash(git:*) Bash(jq:*) Read` -> `["Bash(git:*)", "Bash(jq:*)", "Read"]`
 *
 * Accepts a YAML list or a space/comma separated string. Splitting is
 * parenthesis-aware so `Bash(git:*)` survives intact.
 */
export function parseAllowedTools(value: unknown): string[] {
  const raw: string[] = [];
  if (typeof value === 'string') {
    raw.push(...splitToolList(value));
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') raw.push(...splitToolList(entry));
    }
  }
  const out: string[] = [];
  for (const candidate of raw) {
    const tool = normalizeTool(candidate);
    if (tool) out.push(tool);
  }
  return out;
}

function splitToolList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Frontmatter keys that declare tool access. */
export const ALLOWED_TOOLS_KEYS = ['allowed-tools', 'allowed_tools', 'allowedTools'];
