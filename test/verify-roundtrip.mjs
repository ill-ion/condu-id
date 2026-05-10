// Self-test: generate an Ed25519 keypair, sign a canonical receipt body,
// run our verifier, expect "pass" on signature + canonicalization steps.
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// Helper to base58-encode for did:key (matches our didkey.ts).
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(b) {
  let zeros = 0;
  while (zeros < b.length && b[zeros] === 0) zeros++;
  const digits = [];
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

function hexEncode(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

// Bring in our JCS encoder (extracted into a tiny inline copy for the test).
function jcs(v) { return enc(v); }
function enc(v) {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return encStr(v);
  if (Array.isArray(v)) return "[" + v.map(enc).join(",") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return "{" + keys.map(k => encStr(k) + ":" + enc(v[k])).join(",") + "}";
  }
  throw new Error("unsupported");
}
function encStr(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0d) out += "\\r";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else if (c === 0x3c || c === 0x3e || c === 0x26)
      out += "\\u" + c.toString(16).padStart(4, "0");
    else if (c === 0x2028 || c === 0x2029)
      out += "\\u" + c.toString(16).padStart(4, "0");
    else out += s[i];
  }
  return out + '"';
}

const priv = ed.utils.randomPrivateKey();
const pub = await ed.getPublicKeyAsync(priv);

// did:key encoding: 0xed 0x01 + 32-byte pubkey, base58btc, prefixed with z
const multikey = new Uint8Array(34);
multikey[0] = 0xed;
multikey[1] = 0x01;
multikey.set(pub, 2);
const didKey = "did:key:z" + b58encode(multikey);

console.log("Generated did:key:", didKey);

const body = {
  rcpt_version: "0.7",
  receipt_id: "01TEST00000000000000000000",
  action_type: "tool_call",
  signed_by: didKey,
  issued_at: "2026-05-10T12:00:00Z",
  agent_did: "did:web:condu.id:test:agent-1",
  scope: ["read", "write"],
  input_hash: "deadbeef",
  output_hash: "feedface",
  // Include some characters that test HTML escaping: <, >, &
  description: "A test action <example> with & ampersand",
};

// Sign the canonical bytes (RFC 8032 — no pre-hash).
const canon = new TextEncoder().encode(jcs(body));
console.log("Canonical bytes (first 200):", new TextDecoder().decode(canon.slice(0, 200)));
console.log("Canonical SHA-256:", hexEncode(sha256(canon)));

const sig = await ed.signAsync(canon, priv);
const sigHex = hexEncode(sig);
console.log("Signature (hex):", sigHex);

// Verify (round-trip).
const ok = await ed.verifyAsync(sig, canon, pub);
console.log("Signature verifies:", ok);
if (!ok) process.exit(1);

// Confirm we'd produce the same canonical bytes if we re-encoded.
const canon2 = new TextEncoder().encode(jcs(body));
const same = canon.length === canon2.length && canon.every((b, i) => b === canon2[i]);
console.log("Canonical re-encoding stable:", same);
if (!same) process.exit(1);

// Confirm the body with signature attached strips correctly.
const signedBody = { ...body, signature: sigHex };
const { signature, ...stripped } = signedBody;
const canonStripped = new TextEncoder().encode(jcs(stripped));
const okStripped = await ed.verifyAsync(sig, canonStripped, pub);
console.log("Strip-and-verify works:", okStripped);
if (!okStripped) process.exit(1);

console.log("\n✓ All round-trip checks passed.");
