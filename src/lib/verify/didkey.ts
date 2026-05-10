/**
 * base58btc encode/decode + did:key parser.
 *
 * Reference port of the equivalent helpers in condu-id-api's
 * internal/verify package. Used to recover Ed25519 public keys from
 * `did:key:z...` identifiers.
 *
 * Why hand-rolled instead of multiformats package: we don't need the
 * multibase tag table, just the one alphabet, and avoiding the dep
 * keeps the verifier bundle small (browser ships it).
 */

const ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const ALPHABET_INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]] = i;
  return m;
})();

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;

  const bytes: number[] = [0];
  for (let i = zeros; i < s.length; i++) {
    const c = s[i];
    const v = ALPHABET_INDEX[c];
    if (v === undefined) {
      throw new Error(`base58: invalid char ${c} at ${i}`);
    }
    let carry = v;
    for (let j = bytes.length - 1; j >= 0; j--) {
      const x = bytes[j] * 58 + carry;
      bytes[j] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) out[i] = 0;
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[i];
  return out;
}

export function base58Encode(b: Uint8Array): string {
  if (b.length === 0) return "";
  let zeros = 0;
  while (zeros < b.length && b[zeros] === 0) zeros++;

  const digits: number[] = [];
  for (let i = 0; i < b.length; i++) {
    let carry = b[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  digits.reverse();
  let out = "";
  for (let i = 0; i < zeros; i++) out += "1";
  for (const d of digits) out += ALPHABET[d];
  return out;
}

/**
 * Decode a `did:key:z...` Ed25519 identifier into raw 32-byte public key.
 * Multicodec prefix for Ed25519 public keys is 0xed 0x01.
 */
export function publicKeyFromDIDKey(didKey: string): Uint8Array {
  if (!didKey.startsWith("did:key:")) {
    throw new Error("not a did:key");
  }
  const mb = didKey.slice("did:key:".length);
  if (mb.length < 2 || mb[0] !== "z") {
    throw new Error("did:key must use base58btc multibase (prefix 'z')");
  }
  const raw = base58Decode(mb.slice(1));
  if (raw.length < 2) throw new Error("did:key body too short");
  if (raw[0] !== 0xed || raw[1] !== 0x01) {
    throw new Error(
      `did:key multicodec is not Ed25519 (got ${raw[0].toString(16)} ${raw[1].toString(16)})`
    );
  }
  const key = raw.slice(2);
  if (key.length !== 32) {
    throw new Error(
      `did:key body has ${key.length} bytes after multicodec; want 32`
    );
  }
  return key;
}
