/**
 * Every authority item points back at the file and line that produced it.
 * Position mapping lives here so that a match found inside a Markdown code
 * fence still reports its real line in the real file.
 */

import { compareStrings, normalizeSnippet } from '../manifest/normalize.js';
import type { AuthorityFinding, AuthorityKind, Confidence, Evidence } from '../manifest/schema.js';
import type { ScanUnit } from '../scanner/units.js';

export interface Position {
  line: number;
  column: number;
  /** The full line as it appears in the file. */
  lineText: string;
}

/** Map an offset inside a unit's text to a position in the underlying file. */
export function positionOf(unit: ScanUnit, index: number): Position {
  const clamped = Math.max(0, Math.min(index, unit.text.length));
  const before = unit.text.slice(0, clamped);
  const lastNewline = before.lastIndexOf('\n');
  const newlines = lastNewline === -1 ? 0 : before.split('\n').length - 1;
  const line = unit.startLine + newlines;
  const column = newlines === 0 ? unit.startColumn + clamped : clamped - lastNewline;
  const lineText = unit.docLines[line - 1] ?? currentUnitLine(unit, clamped);
  return { line, column, lineText };
}

function currentUnitLine(unit: ScanUnit, index: number): string {
  const start = unit.text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const end = unit.text.indexOf('\n', index);
  return unit.text.slice(start, end === -1 ? undefined : end);
}

export interface FindingInput {
  unit: ScanUnit;
  kind: AuthorityKind;
  value: string;
  confidence: Confidence;
  /** Machine-readable label describing how the value was recognized. */
  reason: string;
  /** Offset inside `unit.text` of the match. */
  index: number;
  /** Overrides the snippet taken from the matched line. */
  snippet?: string;
}

export function makeFinding(input: FindingInput): AuthorityFinding {
  const position = positionOf(input.unit, input.index);
  const snippet = normalizeSnippet(input.snippet ?? position.lineText);
  const evidence: AuthorityFinding['evidence'] = {
    file: input.unit.file,
    line: position.line,
    reason: input.reason,
    column: position.column,
  };
  if (snippet) evidence.snippet = snippet;
  return {
    kind: input.kind,
    value: input.value,
    confidence: input.confidence,
    evidence,
  };
}

const NEGATION =
  /\b(never|not|don'?t|doesn'?t|won'?t|cannot|can'?t|mustn'?t|shouldn'?t|avoid(?:s|ing)?|forbidden|prohibited|disallowed|refuses?|unsafe|instead\s+of|rather\s+than|without)\b/i;

/**
 * True when the match sits under a prohibition. `Never run \`curl https://evil.example\``
 * is a documented anti-example, not authority the skill intends to use.
 */
export function isNegatedContext(unit: ScanUnit, index: number): boolean {
  const position = positionOf(unit, index);
  const line = position.lineText;
  const before = line.slice(0, Math.max(0, position.column - 1));
  if (NEGATION.test(before)) return true;

  // A prohibition can introduce a list:
  //
  //   The following are all prohibited:
  //
  //   - `cat ~/.aws/credentials`
  //
  // so the lookback walks past blank lines and sibling list items.
  for (let offset = 2; offset <= 8; offset += 1) {
    const previous = unit.docLines[position.line - offset];
    if (previous === undefined) break;
    const trimmed = previous.trim();
    if (!trimmed) continue;
    if (trimmed.endsWith(':') || trimmed.startsWith('#')) return NEGATION.test(previous);
    if (/^([-*+]|\d+\.)\s/.test(trimmed)) continue;
    break;
  }
  return false;
}

/** Deterministic evidence ordering: file, then line, then reason, then snippet. */
export function compareEvidence(a: Evidence, b: Evidence): number {
  return (
    compareStrings(a.file, b.file) ||
    a.line - b.line ||
    compareStrings(a.reason, b.reason) ||
    compareStrings(a.snippet ?? '', b.snippet ?? '')
  );
}

export function evidenceKey(evidence: Evidence): string {
  return [evidence.file, evidence.line, evidence.reason, evidence.snippet ?? ''].join('\u0000');
}

/**
 * Regions of a unit already claimed by a more specific pattern, so that a
 * generic URL sweep does not re-report a host a call-site matcher just handled.
 */
export class ClaimedSpans {
  private readonly spans: Array<[number, number]> = [];

  claim(start: number, end: number): void {
    this.spans.push([start, end]);
  }

  covers(start: number, end: number): boolean {
    return this.spans.some(([from, to]) => start < to && end > from);
  }
}
