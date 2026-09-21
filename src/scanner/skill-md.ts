import matter from 'gray-matter';

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
 * Split SKILL.md into frontmatter and body. Agent Skills are centered on this
 * file, and its frontmatter is the one place authority is *declared* rather than
 * inferred.
 */
export function parseSkillMarkdown(content: string): ParsedSkillMarkdown {
  if (!/^---\r?\n/.test(content)) {
    return { frontmatter: null, bodyStartLine: 1 };
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    // Malformed frontmatter is treated as body text rather than a hard failure.
    return { frontmatter: null, bodyStartLine: 1 };
  }

  const raw = typeof parsed.matter === 'string' ? parsed.matter.replace(/^\n/, '') : '';
  if (!raw.trim()) return { frontmatter: null, bodyStartLine: 1 };

  const rawLines = raw.split('\n').length;
  return {
    frontmatter: {
      raw,
      startLine: 2,
      data: isRecord(parsed.data) ? parsed.data : {},
    },
    // opening fence + yaml + closing fence
    bodyStartLine: 1 + rawLines + 1 + 1,
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
