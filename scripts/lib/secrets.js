'use strict';

/**
 * Patterns for credentials that must never be written into tracked files.
 * Used by the pre:write:secrets hook and the CI repository scan.
 */
const SECRET_PATTERNS = [
  { name: 'Shopify Admin API access token (shpat_)', regex: /\bshpat_[a-fA-F0-9]{32}\b/ },
  { name: 'Shopify app shared secret (shpss_)', regex: /\bshpss_[a-fA-F0-9]{32}\b/ },
  { name: 'Shopify custom app access token (shpca_)', regex: /\bshpca_[a-fA-F0-9]{32}\b/ },
  { name: 'Shopify private app password (shppa_)', regex: /\bshppa_[a-fA-F0-9]{32}\b/ },
  { name: 'Stripe live secret key', regex: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/ },
  { name: 'AWS access key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ }
];

/** Returns the names of every pattern found in text (each name at most once). */
function findSecrets(text) {
  const source = String(text || '');
  return SECRET_PATTERNS.filter(pattern => pattern.regex.test(source)).map(pattern => pattern.name);
}

/**
 * Files where secrets belong: .env and .env.<something>, except templates
 * such as .env.example that get committed.
 */
function isSecretsFile(filePath) {
  const base = String(filePath || '').split(/[\\/]/).pop().toLowerCase();
  if (!/^\.env(\..+)?$/.test(base)) return false;
  return !/\.(example|sample|template|dist)$/.test(base);
}

module.exports = { SECRET_PATTERNS, findSecrets, isSecretsFile };
