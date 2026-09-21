/**
 * Extractors do not see raw files; they see scan units. A unit is a contiguous
 * region with one effective language and one evidence context, which is what
 * lets a `curl` inside a fenced README example be scored differently from the
 * same `curl` in a shell script without every extractor re-parsing Markdown.
 */

import type { Language, ScannedFile } from '../manifest/schema.js';
import { isSkillFile } from './classify-file.js';
import { parseSkillMarkdown } from './skill-md.js';

export type UnitContext =
  | 'source'
  | 'frontmatter'
  | 'md-code'
  | 'md-inline'
  | 'md-prose';

export interface ScanUnit {
  /** Skill-relative path of the file this unit came from. */
  file: string;
  /** Effective language of `text`. */
  language: Language;
  context: UnitContext;
  text: string;
  /** 1-based absolute line of the first character of `text`. */
  startLine: number;
  /** 1-based column of the first character of `text` (only ever > 1 for inline spans). */
  startColumn: number;
  /** Lines of the whole file, for context lookups such as negation. */
  docLines: readonly string[];
  /**
   * True when shell content is only suspected (unlabelled fence, inline code),
   * so command extraction must require a recognizable binary.
   */
  looseShell: boolean;
  isSkillFile: boolean;
}

const FENCE_LANGUAGES: Record<string, Language> = {
  sh: 'shell',
  shell: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ksh: 'shell',
  console: 'shell',
  shellsession: 'shell',
  terminal: 'shell',
  py: 'python',
  python: 'python',
  python3: 'python',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'typescript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
};

/** Fence tags that mean "this is a transcript of commands" even without a language. */
const LOOSE_FENCE_TAGS = new Set(['', 'text', 'txt', 'plain', 'output', 'log', 'code', 'example']);

export function buildScanUnits(file: ScannedFile): ScanUnit[] {
  const docLines = file.content.split('\n');
  if (file.language !== 'markdown') {
    return [
      {
        file: file.path,
        language: file.language,
        context: 'source',
        text: file.content,
        startLine: 1,
        startColumn: 1,
        docLines,
        looseShell: false,
        isSkillFile: false,
      },
    ];
  }
  return buildMarkdownUnits(file, docLines);
}

function buildMarkdownUnits(file: ScannedFile, docLines: readonly string[]): ScanUnit[] {
  const units: ScanUnit[] = [];
  const skillFile = isSkillFile(file.path);
  const base = {
    file: file.path,
    docLines,
    isSkillFile: skillFile,
  };

  const { frontmatter } = parseSkillMarkdown(file.content);
  let lineIndex = 0;

  if (frontmatter) {
    units.push({
      ...base,
      language: 'yaml',
      context: 'frontmatter',
      text: frontmatter.raw,
      startLine: frontmatter.startLine,
      startColumn: 1,
      looseShell: false,
    });
    // Skip past the closing delimiter.
    lineIndex = frontmatter.startLine - 1 + frontmatter.raw.split('\n').length;
    while (lineIndex < docLines.length && !/^---\s*$/.test(docLines[lineIndex] ?? '')) {
      lineIndex += 1;
    }
    lineIndex += 1;
  }

  let fence: { marker: string; language: Language; looseShell: boolean; startLine: number; lines: string[] } | null =
    null;

  for (; lineIndex < docLines.length; lineIndex += 1) {
    const line = docLines[lineIndex] ?? '';

    if (fence) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]!.startsWith(fence.marker[0]!) && close[1]!.length >= fence.marker.length) {
        units.push({
          ...base,
          language: fence.language,
          context: 'md-code',
          text: fence.lines.join('\n'),
          startLine: fence.startLine,
          startColumn: 1,
          looseShell: fence.looseShell,
        });
        fence = null;
        continue;
      }
      fence.lines.push(line);
      continue;
    }

    const open = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (open) {
      const tag = (open[2] ?? '').toLowerCase();
      const mapped = FENCE_LANGUAGES[tag];
      fence = {
        marker: open[1]!,
        language: mapped ?? 'other',
        looseShell: mapped === undefined || (mapped === 'shell' && LOOSE_FENCE_TAGS.has(tag)),
        startLine: lineIndex + 2,
        lines: [],
      };
      continue;
    }

    // Inline code spans become their own units; the remaining prose keeps its columns.
    let prose = line;
    for (const span of findInlineSpans(line)) {
      units.push({
        ...base,
        language: 'other',
        context: 'md-inline',
        text: span.text,
        startLine: lineIndex + 1,
        startColumn: span.column,
        looseShell: true,
      });
      prose =
        prose.slice(0, span.column - 1) +
        ' '.repeat(span.text.length) +
        prose.slice(span.column - 1 + span.text.length);
    }

    if (prose.trim()) {
      units.push({
        ...base,
        language: 'markdown',
        context: 'md-prose',
        text: prose,
        startLine: lineIndex + 1,
        startColumn: 1,
        looseShell: false,
      });
    }
  }

  if (fence) {
    // Unterminated fence: keep what we saw rather than dropping it.
    units.push({
      ...base,
      language: fence.language,
      context: 'md-code',
      text: fence.lines.join('\n'),
      startLine: fence.startLine,
      startColumn: 1,
      looseShell: fence.looseShell,
    });
  }

  return units;
}

const INLINE_SPAN = /(`+)([^`]+?)\1/g;

/** Inline code spans on a single line, with 1-based start columns of the span body. */
function findInlineSpans(line: string): Array<{ text: string; column: number }> {
  const out: Array<{ text: string; column: number }> = [];
  for (const match of line.matchAll(INLINE_SPAN)) {
    const ticks = match[1]!.length;
    const body = match[2]!;
    if (!body.trim()) continue;
    out.push({ text: body, column: (match.index ?? 0) + ticks + 1 });
  }
  return out;
}
