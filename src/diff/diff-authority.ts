/**
 * Semantic set diff, not a JSON diff. Content hashes change on every edit;
 * authority does not. `code change != authority change` is the whole product.
 */

import { compareStrings } from '../manifest/normalize.js';
import {
  AUTHORITY_KINDS,
  CONFIDENCE_RANK,
  authorityEntries,
  type AuthorityKind,
  type AuthorityModel,
  type Confidence,
  type Evidence,
} from '../manifest/schema.js';

export interface DiffEntry {
  kind: AuthorityKind;
  value: string;
  /** Confidence in the newer manifest, or in the older one for removals. */
  confidence: Confidence;
  /** Present when the same value was already known at a different confidence. */
  previousConfidence?: Confidence;
  evidence: Evidence[];
}

export interface AuthorityDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  unchanged: DiffEntry[];
  /** Same value, but now seen in a more authoritative place (docs -> real code). */
  escalated: DiffEntry[];
  previousCount: number;
  currentCount: number;
}

export interface GateOptions {
  /** Treat low-confidence additions as drift too. */
  strict?: boolean;
}

export function diffAuthority(before: AuthorityModel, after: AuthorityModel): AuthorityDiff {
  const oldEntries = indexByKindAndValue(before);
  const newEntries = indexByKindAndValue(after);

  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];
  const escalated: DiffEntry[] = [];

  for (const [key, entry] of newEntries) {
    const previous = oldEntries.get(key);
    if (!previous) {
      added.push(entry);
      continue;
    }
    if (previous.confidence !== entry.confidence) {
      escalated.push({ ...entry, previousConfidence: previous.confidence });
      continue;
    }
    unchanged.push(entry);
  }

  for (const [key, entry] of oldEntries) {
    if (!newEntries.has(key)) removed.push(entry);
  }

  sortEntries(added);
  sortEntries(removed);
  sortEntries(unchanged);
  sortEntries(escalated);

  return {
    added,
    removed,
    unchanged,
    escalated,
    previousCount: oldEntries.size,
    currentCount: newEntries.size,
  };
}

function indexByKindAndValue(model: AuthorityModel): Map<string, DiffEntry> {
  const out = new Map<string, DiffEntry>();
  for (const { kind, item } of authorityEntries(model)) {
    out.set(`${kind}\u0000${item.value}`, {
      kind,
      value: item.value,
      confidence: item.confidence,
      evidence: item.evidence,
    });
  }
  return out;
}

const KIND_ORDER = new Map(AUTHORITY_KINDS.map((kind, index) => [kind, index]));

function sortEntries(entries: DiffEntry[]): void {
  entries.sort(
    (a, b) =>
      (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0) ||
      compareStrings(a.value, b.value),
  );
}

/**
 * Additions that require review. Low-confidence findings — documentation and
 * prohibited examples — are reported but do not fail by default, because a
 * README edit is not an authority change.
 */
export function gatedEntries(diff: AuthorityDiff, options: GateOptions = {}): DiffEntry[] {
  const gated = diff.added.filter((entry) => failsGate(entry.confidence, options));
  for (const entry of diff.escalated) {
    const wasGated = failsGate(entry.previousConfidence ?? 'unknown', options);
    if (!wasGated && failsGate(entry.confidence, options)) gated.push(entry);
  }
  sortEntries(gated);
  return gated;
}

function failsGate(confidence: Confidence, options: GateOptions): boolean {
  if (options.strict) return true;
  if (confidence === 'unknown') return true; // a new runtime-computed resource is still new
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK.medium;
}

/** True when the skill gained authority that requires review. */
export function isExpansion(diff: AuthorityDiff, options: GateOptions = {}): boolean {
  return gatedEntries(diff, options).length > 0;
}

/** Additions that are reported for information only. */
export function informationalEntries(diff: AuthorityDiff, options: GateOptions = {}): DiffEntry[] {
  const gated = new Set(gatedEntries(diff, options).map((entry) => `${entry.kind}\u0000${entry.value}`));
  const out = [...diff.added, ...diff.escalated].filter(
    (entry) => !gated.has(`${entry.kind}\u0000${entry.value}`),
  );
  sortEntries(out);
  return out;
}
