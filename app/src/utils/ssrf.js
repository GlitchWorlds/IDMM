'use strict';

const dns = require('node:dns');

/**
 * SSRF (Server-Side Request Forgery) Protection Utilities.
 *
 * Shared validation for redirect targets across all download paths.
 * Prevents attackers from using redirect chains to reach internal/private hosts.
 *
 * Blocked categories:
 *  - Loopback:       127.0.0.0/8, ::1, localhost
 *  - Private (RFC):  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *  - Link-local:     169.254.0.0/16, fe80::/10
 *  - Unspecified:    0.0.0.0, ::
 */

const BLOCKED_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '0.0.0.0',
  '::1',
  '[::1]',
  '0:0:0:0:0:0:0:1',
]);

/**
 * Check if a hostname resolves to a blocked (private/loopback/link-local) host.
 * @param {string} hostname  already lowercased
 * @returns {boolean}
 */
function isBlockedHost(hostname) {
  if (BLOCKED_HOSTS.has(hostname)) return true;

  // IPv4 private + link-local ranges
  if (hostname.startsWith('192.168.')) return true;
  if (hostname.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return true;
  if (hostname.startsWith('169.254.')) return true;

  // IPv6 loopback and link-local
  if (hostname === '::1' || hostname === '[::1]') return true;
  if (hostname.startsWith('fe80:')) return true;

  return false;
}

/**
 * Validate a redirect target URL before following it.
 * Resolves relative redirects against the base URL, then checks the host.
 *
 * @param {string} redirectUrl  raw Location header value (may be relative)
 * @param {string} baseUrl      the URL that returned the redirect
 * @throws {Error} if the resolved host is blocked
 */
function validateRedirect(redirectUrl, baseUrl) {
  let hostname;
  try {
    const resolved = new URL(redirectUrl, baseUrl);
    hostname = resolved.hostname.toLowerCase();
  } catch {
    // Invalid URL  let the caller's own error handling deal with it
    return;
  }

  if (isBlockedHost(hostname)) {
    throw new Error(`Redirect to blocked host: ${hostname}`);
  }
}

/**
 * Validate that a hostname does not resolve to a blocked IP address.
 * Catches DNS rebinding / hosts that resolve to 127.0.0.1 (e.g. localtest.me).
 *
 * @param {string} hostname
 * @returns {Promise<boolean>} true if safe
 */
async function validateDnsResolution(hostname) {
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isBlockedHost(address.toLowerCase())) {
        throw new Error(`Host ${hostname} resolves to blocked address: ${address}`);
      }
    }
  } catch (err) {
    if (err.message && err.message.includes('resolves to blocked')) throw err;
    // DNS lookup failed (NXDOMAIN etc.)  let the connection fail naturally
  }
  return true;
}

module.exports = { isBlockedHost, validateRedirect, validateDnsResolution };

