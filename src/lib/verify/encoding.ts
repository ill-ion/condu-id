/**
 * Signature encoding helpers.
 *
 * RCPT receipts in v1 may carry signatures encoded as hex, base58btc,
 * or base64 (different SDKs default differently — TS uses hex by
 * default, Python uses hex, Go uses hex, but historically receipts
 * were captured with base58 too). We accept all three to maximize
 * compatibility, matching the Go verifier's decodeSignature().
 */

import { base58Decode } from "./didkey";

const SIG_LEN = 64; // Ed25519 signature is 64 bytes

export function decodeSignature(s: string): Uint8Array {
  // Try hex.
  if (/^[0-9a-fA-F]+$/.test(s) && s.length === SIG_LEN * 2) {
    return hexDecode(s);
  }
  // Try base64 (no padding required).
  try {
    const b = base64Decode(s);
    if (b.length === SIG_LEN) return b;
  } catch {
    // fall through
  }
  // Try base58.
  try {
    const b = base58Decode(s);
    if (b.length === SIG_LEN) return b;
  } catch {
    // fall through
  }
  throw new Error(
    `signature is not hex/base58/base64 (got ${s.length} chars)`
  );
}

export function hexDecode(s: string): Uint8Array {
  if (s.length % 2 !== 0) throw new Error("hex: odd length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) throw new Error(`hex: invalid char at ${i * 2}`);
    out[i] = v;
  }
  return out;
}

export function hexEncode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, "0");
  }
  return s;
}

export function base64Decode(s: string): Uint8Array {
  // Browser: atob. Workers: atob. Node: atob (since Node 16). Universal.
  const cleaned = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = cleaned + "===".slice(0, (4 - (cleaned.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
