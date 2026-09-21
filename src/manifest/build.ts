/**
 * Findings in, authority model out: dedupe, merge confidence, sort everything.
 * This is the only place the canonical authority model is assembled.
 */

import { compareEvidence, evidenceKey } from '../evidence/evidence.js';
import { compareStrings } from './normalize.js';
import {
  bucketFor,
  emptyAuthority,
  maxConfidence,
  type AuthorityFinding,
  type AuthorityItem,
  type AuthorityModel,
  type Evidence,
} from './schema.js';

/**
 * Evidence per item is capped: three sorted entries explain a finding, and an
 * unbounded list would turn every documentation edit into lockfile churn.
 */
export const MAX_EVIDENCE_PER_ITEM = 3;

export function buildAuthority(findings: readonly AuthorityFinding[]): AuthorityModel {
  const model = emptyAuthority();
  const groups = new Map<string, { finding: AuthorityFinding; evidence: Map<string, Evidence> }>();

  for (const finding of findings) {
    const key = `${finding.kind}\u0000${finding.value}`;
    const existing = groups.get(key);
    const evidence: Evidence = {
      file: finding.evidence.file,
      line: finding.evidence.line,
      reason: finding.evidence.reason,
    };
    if (finding.evidence.snippet) evidence.snippet = finding.evidence.snippet;

    if (!existing) {
      groups.set(key, {
        finding,
        evidence: new Map([[evidenceKey(evidence), evidence]]),
      });
      continue;
    }
    existing.finding = {
      ...existing.finding,
      confidence: maxConfidence(existing.finding.confidence, finding.confidence),
    };
    const id = evidenceKey(evidence);
    if (!existing.evidence.has(id)) existing.evidence.set(id, evidence);
  }

  for (const { finding, evidence } of groups.values()) {
    const item: AuthorityItem = {
      value: finding.value,
      confidence: finding.confidence,
      evidence: [...evidence.values()].sort(compareEvidence).slice(0, MAX_EVIDENCE_PER_ITEM),
    };
    bucketFor(model, finding.kind).push(item);
  }

  sortModel(model);
  return model;
}

function sortModel(model: AuthorityModel): void {
  const byValue = (a: AuthorityItem, b: AuthorityItem): number => compareStrings(a.value, b.value);
  model.network.sort(byValue);
  model.filesystem.read.sort(byValue);
  model.filesystem.write.sort(byValue);
  model.environment.sort(byValue);
  model.shell.sort(byValue);
  model.tools.sort(byValue);
  model.mcp.sort(byValue);
}
