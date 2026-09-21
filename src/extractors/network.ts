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
import { iterateCalls, resolveUrlExpression, splitTopLevel } from './resolve.js';
import { KNOWN_BINARIES } from './binaries.js';

/** Clients whose first argument is a URL. Used for precise reasons and dynamic detection. */
const HTTP_CLIENT_ROOTS = new Set([
  'aiohttp',
  'axios',
  'client',
  'fetch',
  'got',
  'http',
  'httpclient',
  'httpx',
  'https',
  'ky',
  'needle',
  'request',
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

/** Calls that are always a network reference regardless of receiver. */
const ALWAYS_NETWORK_CALLS = new Set([
  'fetch',
  'urlopen',
  'HTTPSConnection',
  'HTTPConnection',
  'WebSocket',
  'connect_url',
]);

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

    // 1. Client call sites: precise reasons, and the only place `<dynamic>` is emitted.
    for (const call of iterateCalls(unit.text)) {
      const segments = call.callee.toLowerCase().split('.');
      const root = segments[0] ?? '';
      const name = call.name;
      const lowerName = name.toLowerCase();
      const isClient =
        ALWAYS_NETWORK_CALLS.has(name) ||
        (HTTP_CLIENT_ROOTS.has(root) && HTTP_METHOD_NAMES.has(lowerName)) ||
        (HTTP_CLIENT_ROOTS.has(segments[segments.length - 2] ?? '') && HTTP_METHOD_NAMES.has(lowerName));
      if (!isClient) continue;

      const first = splitTopLevel(call.args, ',')[0] ?? '';
      if (!first.trim()) continue;
      const resolved = resolveUrlExpression(first);
      const negated = isNegatedContext(unit, call.index);

      if (resolved.dynamic) {
        findings.push(
          makeFinding({
            unit,
            kind: 'network',
            value: DYNAMIC,
            confidence: confidenceFor(unit, { dynamic: true }),
            reason: 'dynamic-request-url',
            index: call.index,
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
          index: call.index,
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
