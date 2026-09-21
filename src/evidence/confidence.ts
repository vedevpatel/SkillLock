/**
 * Confidence, not certainty.
 *
 *   high     executable source literal, or a declared capability
 *   medium   imperative instruction in SKILL.md, or config data
 *   low      documentation, examples, and anything under a negation
 *   unknown  the value is computed at runtime
 *
 * v0 classifies by file type and region rather than by understanding prose.
 * That is not perfect. It is good enough, and it is honest about which is which.
 */

import { isExecutableLanguage } from '../scanner/classify-file.js';
import type { ScanUnit } from '../scanner/units.js';
import type { Confidence } from '../manifest/schema.js';

export interface ConfidenceInput {
  /** The value could not be resolved statically. */
  dynamic?: boolean;
  /** The value came from a structured declaration such as `allowed-tools`. */
  declared?: boolean;
  /** The surrounding text prohibits the action ("Never run `curl ...`"). */
  negated?: boolean;
  /** The match is a Markdown link target rather than an invocation. */
  documentationLink?: boolean;
}

export function confidenceFor(unit: ScanUnit, input: ConfidenceInput = {}): Confidence {
  if (input.dynamic) return 'unknown';
  if (input.declared) return 'high';
  if (input.negated) return 'low';
  if (input.documentationLink) return 'low';

  switch (unit.context) {
    case 'frontmatter':
      return 'high';
    case 'source':
      if (isExecutableLanguage(unit.language)) return 'high';
      if (unit.language === 'json' || unit.language === 'yaml') return 'medium';
      return 'low';
    case 'md-code':
    case 'md-inline':
    case 'md-prose':
      return unit.isSkillFile ? 'medium' : 'low';
  }
}
