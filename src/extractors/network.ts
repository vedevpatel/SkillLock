/**
 * What remote hosts does this skill appear to reference?
 *
 * Values are hosts, not URLs: every path under `api.github.com` is the same
 * authority, and collapsing them is what makes the diff readable.
 */

import { DYNAMIC } from '../manifest/schema.js';
import { normalizeUrl } from '../manifest/normalize.js';
import { ClaimedSpans, isNegatedContext, makeFinding } from '../evidence/evidence.js';
import { confidenceFor } from '../evidence/confidence.js';
import type { Extractor } from './types.js';
import { iterateCalls, partValueIndex, resolveUrlExpression, splitTopLevelParts } from './resolve.js';
import { KNOWN_BINARIES } from './binaries.js';

/**
 * Receivers whose methods take a URL as the first argument. Deliberately does
 * not include `fetch` or `request`: those are method names, and treating them as
 * receivers turns every local `fetch(a, b)` helper into a phantom network call.
 */
const HTTP_CLIENT_ROOTS = new Set([
  'aiohttp',
  'axios',
  'client',
  'http',
  'httpclient',
  'httpx',
  'https',
  'ky',
  'needle',
  'requests',
  'session',
  'superagent',
  'undici',
  'urllib',
  'urllib2',
  'urllib3',
]);

const HTTP_METHOD_NAMES = new Set([
  'delete',
  'download',
  'fetch',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'request',
  'send',
  'stream',
  'urlopen',
]);

/** Calls that are a network reference in any language. */
const ALWAYS_NETWORK_CALLS = new Set(['urlopen', 'HTTPSConnection', 'HTTPConnection']);

/**
 * `fetch` is the platform API in JS, but in Python it is usually a local helper,
 * so bare calls only count in JS-like units.
 */
const JS_NETWORK_CALLS = new Set(['fetch', 'WebSocket', 'EventSource', 'got']);

/**
 * Hosts that appear in documents as identifiers (XML namespaces, licences) and
 * are not fetched. Excluded to keep the manifest signal-dense.
 */
const NAMESPACE_HOSTS = new Set([
  'creativecommons.org',
  'json-schema.org',
  'opensource.org',
  'schema.org',
  'schemas.microsoft.com',
  'spdx.org',
  'www.apache.org',
  'www.gnu.org',
  'www.w3.org',
  'xmlns.oasis-open.org',
]);

const URL_LITERAL = /\b(?:https?|wss?|ftps?):\/\/[^\s"'`<>()[\]{},;\\|]+/gi;

/** `curl example.com/x`, `wget -q foo.dev/file`: a bare host after a fetching binary. */
const BARE_HOST_COMMAND =
  /\b(curl|wget|http|https|httpie|aria2c|scp|sftp|ssh|nc|ncat|netcat|telnet|rsync)\b((?:\s+-{1,2}[^\s]+)*)\s+((?:https?:\/\/)?[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z]{2,}(?::\d+)?(?:\/[^\s"'`]*)?)/g;

export const networkExtractor: Extractor = {
  name: 'network',
  supports: () => true,
  extract(unit) {
    const findings = [];
    const claimed = new ClaimedSpans();

    const jsLike =
      unit.language === 'javascript' || unit.language === 'typescript' || unit.language === 'other';

    // 1. Client call sites: precise reasons, and the only place `<dynamic>` is emitted.
    for (const call of iterateCalls(unit.text)) {
      const segments = call.callee.toLowerCase().split('.');
      const root = segments[0] ?? '';
      const name = call.name;
      const lowerName = name.toLowerCase();
      const isClient =
        ALWAYS_NETWORK_CALLS.has(name) ||
        (jsLike && JS_NETWORK_CALLS.has(name)) ||
        (HTTP_CLIENT_ROOTS.has(root) && HTTP_METHOD_NAMES.has(lowerName)) ||
        (HTTP_CLIENT_ROOTS.has(segments[segments.length - 2] ?? '') && HTTP_METHOD_NAMES.has(lowerName));
      if (!isClient) continue;

      const firstPart = splitTopLevelParts(call.args, ',')[0];
      const first = firstPart?.text ?? '';
      if (!first.trim() || !firstPart) continue;
      const resolved = resolveUrlExpression(first);
      // Point the evidence at the argument, not at the line the call starts on.
      const argIndex = call.openIndex + 1 + partValueIndex(firstPart);
      const negated = isNegatedContext(unit, argIndex);

      if (resolved.dynamic) {
        findings.push(
          makeFinding({
            unit,
            kind: 'network',
            value: DYNAMIC,
            confidence: confidenceFor(unit, { dynamic: true }),
            reason: 'dynamic-request-url',
            index: argIndex,
          }),
        );
        claimed.claim(call.index, call.end);
        continue;
      }

      const host = normalizeUrl(resolved.value);
      if (!host || NAMESPACE_HOSTS.has(host)) continue;
      findings.push(
        makeFinding({
          unit,
          kind: 'network',
          value: host,
          confidence: confidenceFor(unit, { negated }),
          reason: 'literal-request-url',
          index: argIndex,
        }),
      );
      claimed.claim(call.index, call.end);
    }

    // 2. Every remaining URL literal, wherever it appears.
    for (const match of unit.text.matchAll(URL_LITERAL)) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (claimed.covers(index, end)) continue;
      const host = normalizeUrl(match[0]);
      if (!host || host === DYNAMIC || NAMESPACE_HOSTS.has(host)) continue;
      claimed.claim(index, end);
      const isLink = isMarkdownLinkTarget(unit.text, index);
      findings.push(
        makeFinding({
          unit,
          kind: 'network',
          value: host,
          confidence: confidenceFor(unit, {
            negated: isNegatedContext(unit, index),
            ...(isLink ? { documentationLink: true } : {}),
          }),
          reason: isLink ? 'markdown-link-url' : 'literal-url',
          index,
        }),
      );
    }

    // 3. Bare hosts passed to fetching binaries: `curl example.com/data`.
    for (const match of unit.text.matchAll(BARE_HOST_COMMAND)) {
      const target = match[3] ?? '';
      const index = (match.index ?? 0) + match[0].length - target.length;
      if (claimed.covers(index, index + target.length)) continue;
      const binary = (match[1] ?? '').toLowerCase();
      if (!KNOWN_BINARIES.has(binary)) continue;
      const host = normalizeUrl(target);
      if (!host || host === DYNAMIC || NAMESPACE_HOSTS.has(host)) continue;
      claimed.claim(index, index + target.length);
      findings.push(
        makeFinding({
          unit,
          kind: 'network',
          value: host,
          confidence: confidenceFor(unit, { negated: isNegatedContext(unit, index) }),
          reason: `${binary}-host`,
          index,
        }),
      );
    }

    return findings;
  },
};

/** True when the URL at `index` is the target of a Markdown link. */
function isMarkdownLinkTarget(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 2), index);
  return before.endsWith('](') || before.endsWith('(<') || text[index - 1] === '<';
}
