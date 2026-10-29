'use strict';

/**
 * Bounded stdin reading and forgiving JSON parsing for hooks. A hook must
 * never crash or hang the session because of unexpected input.
 */

const DEFAULT_MAX_BYTES = 1024 * 1024;

function resolveMaxBytes(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

/**
 * Reads at most maxBytes from the stream. Anything beyond is drained and
 * dropped, and the result is marked truncated.
 */
function readStdin(stream, maxBytes = DEFAULT_MAX_BYTES) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0;
    let truncated = false;

    stream.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size >= maxBytes) {
        truncated = true;
        return;
      }
      const room = maxBytes - size;
      if (buffer.length > room) {
        chunks.push(buffer.subarray(0, room));
        size += room;
        truncated = true;
      } else {
        chunks.push(buffer);
        size += buffer.length;
      }
    });
    stream.on('end', () => resolve({ raw: Buffer.concat(chunks).toString('utf8'), truncated }));
    stream.on('error', () => resolve({ raw: Buffer.concat(chunks).toString('utf8'), truncated: true }));
  });
}

/** Returns the parsed object, or null for empty, invalid or non-object input. */
function parseInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { DEFAULT_MAX_BYTES, resolveMaxBytes, readStdin, parseInput };
