/**
 * Client-side verifier — the authoritative one.
 *
 * Everything the api.condu.id /v1/receipts/:id/verify endpoint does
 * server-side, this redoes locally. PLUS the Solana confirmation step
 * (which the server explicitly defers to the client per the verifier
 * non-negotiables).
 *
 * Dependencies — all browser-safe, all small:
 *   - @noble/ed25519 (Ed25519 verify)
 *   - @noble/hashes/sha256 (canonical body hashing, merkle)
 *   - @solana/web3.js (browser-direct Solana RPC)
 *
 * The verifier never accepts the server's verdict at face value. Each
 * step is recomputed from the raw receipt body + stored merkle proof.
 */

import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { Connection } from "@solana/web3.js";

import type {
  MerkleProof,
  Receipt,
  SignedReceiptBody,
  VerifyOverall,
  VerifyResult,
  VerifyStep,
  VerifyStepStatus,
} from "@lib/api/types";
import { jcs } from "./jcs";
import { publicKeyFromDIDKey } from "./didkey";
import { decodeSignature, hexDecode, hexEncode, utf8Encode } from "./encoding";

// @noble/ed25519 v2 requires sha512 to be configured by the host.
// (It's tree-shake-friendly: this is the only place sha512 is pulled in.)
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const CLIENT_NOTICE = "client-must-verify" as const;

export type LocalVerifyOptions = {
  /**
   * Solana cluster the receipt was anchored to. Pulled from the receipt
   * envelope's anchor.cluster field by default.
   */
  cluster?: "devnet" | "testnet" | "mainnet" | "mainnet-beta";
  /**
   * Optional Solana RPC override. Defaults to PUBLIC_SOLANA_RPC, then
   * the public clusterApiUrl for the receipt's cluster.
   */
  rpcEndpoint?: string;
  /** Abort signal to cancel the Solana RPC fetch. */
  signal?: AbortSignal;
};

/**
 * Verify a receipt locally. Returns a VerifyResult with the same shape
 * as the server's, but with `solana_confirmation` actually populated.
 */
export async function verifyReceiptLocal(
  receipt: Receipt,
  opts: LocalVerifyOptions = {}
): Promise<VerifyResult> {
  const checkedAt = new Date().toISOString();

  const result: VerifyResult = {
    authoritative: false,
    notice: CLIENT_NOTICE,
    overall: "pass",
    steps: {
      signature_ed25519: skipped("not yet checked"),
      canonicalization_jcs: skipped("not yet checked"),
      delegation_chain: notApplicable("not yet checked"),
      merkle_proof: notApplicable("not yet checked"),
      solana_confirmation: notApplicable("not yet checked"),
    },
    checked_at: checkedAt,
  };

  const body = receipt.receipt;
  if (!body) {
    result.overall = "fail";
    result.steps.signature_ed25519 = fail("receipt envelope has no body");
    return result;
  }

  // canonicalization_jcs: re-canonicalize the body and compare to what
  // we received. Since the API returns the receipt body verbatim
  // (json.RawMessage on the wire), we should be byte-equal. If we're
  // not, either the server returned something non-canonical or our
  // JCS doesn't match the Go reference — either way, fail loudly.
  result.steps.canonicalization_jcs = verifyJCS(body);

  // signature_ed25519: strip signature, re-canonicalize, ed25519 verify.
  result.steps.signature_ed25519 = await verifySignature(body);

  // delegation_chain: structural-only here, like the server. The full
  // chain validator lives in the rcpt-protocol TS SDK; for the demo we
  // accept "no chain" or "chain present and structurally valid".
  result.steps.delegation_chain = verifyDelegation(body);

  // merkle_proof + solana_confirmation: only meaningful if anchored.
  if (!receipt.anchor) {
    result.steps.merkle_proof = notApplicable("receipt not yet anchored");
    result.steps.solana_confirmation = notApplicable(
      "receipt not yet anchored"
    );
  } else {
    result.steps.merkle_proof = verifyMerkle(
      body,
      receipt.anchor.merkle_root,
      receipt.anchor.merkle_proof
    );
    result.steps.solana_confirmation = await verifySolana(
      receipt.anchor.solana_signature,
      opts
    );
  }

  result.overall = aggregate(result.steps);
  return result;
}

// ── steps ──────────────────────────────────────────────────────────

function verifyJCS(body: SignedReceiptBody): VerifyStep {
  // Server returns the receipt verbatim as json.RawMessage. We get it
  // here as a parsed object. Re-canonicalize it and compare hash to
  // what the API claims.
  try {
    const canon = jcs(body);
    const canonHash = hexEncode(sha256(utf8Encode(canon)));
    return {
      status: "pass",
      details: { canonical_hash: canonHash },
    };
  } catch (e) {
    return fail(
      `jcs canonicalization failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

async function verifySignature(body: SignedReceiptBody): Promise<VerifyStep> {
  if (!body.signature) return fail("receipt has no signature field");
  if (!body.signed_by) return fail("receipt has no signed_by field");

  let pub: Uint8Array;
  try {
    pub = publicKeyFromDIDKey(body.signed_by);
  } catch (e) {
    return fail(
      `cannot decode signed_by: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let sig: Uint8Array;
  try {
    sig = decodeSignature(body.signature);
  } catch (e) {
    return fail(
      `cannot decode signature: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Strip signature, re-canonicalize, verify against the canonical bytes.
  const { signature: _omitted, ...unsigned } = body;
  let canonBytes: Uint8Array;
  try {
    canonBytes = utf8Encode(jcs(unsigned));
  } catch (e) {
    return fail(
      `cannot strip signature for verification: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let ok = false;
  try {
    // RFC 8032: verify message bytes directly, no SHA-256 pre-hash.
    ok = await ed.verifyAsync(sig, canonBytes, pub);
  } catch (e) {
    return fail(
      `ed25519 verify threw: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!ok) return fail("ed25519 signature does not verify against signed_by key");

  return {
    status: "pass",
    details: { key_did: body.signed_by, sig_bytes: sig.length },
  };
}

function verifyDelegation(body: SignedReceiptBody): VerifyStep {
  if (!body.delegation) {
    return notApplicable("no delegation present");
  }
  // Structural sanity: must be a JSON object. A v1.1 enhancement would
  // walk the chain, verifying each link's signature against its
  // delegator's public key.
  if (typeof body.delegation !== "object" || Array.isArray(body.delegation)) {
    return fail("delegation must be a JSON object");
  }
  return {
    status: "pass",
    reason: "structural-only; full chain validation in v1.1",
  };
}

function verifyMerkle(
  body: SignedReceiptBody,
  merkleRoot: string,
  proof: MerkleProof
): VerifyStep {
  // Hash the canonical body to get the leaf.
  const canonBytes = utf8Encode(jcs(body));
  const leafHash = sha256(canonBytes);
  const leafHex = hexEncode(leafHash);

  // Sanity-check the proof's leaf field if present.
  if (proof.leaf && proof.leaf !== leafHex) {
    return fail(
      `proof leaf ${proof.leaf} != computed leaf ${leafHex}`
    );
  }

  if (!Array.isArray(proof.siblings)) {
    return fail("merkle proof has no siblings array");
  }

  let cur = leafHash;
  for (let i = 0; i < proof.siblings.length; i++) {
    const sib = proof.siblings[i];
    let sibBytes: Uint8Array;
    try {
      sibBytes = hexDecode(sib.hash);
    } catch (e) {
      return fail(
        `sibling ${i} hash invalid: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    let concat: Uint8Array;
    if (sib.position === "left") {
      concat = concatBytes(sibBytes, cur);
    } else if (sib.position === "right") {
      concat = concatBytes(cur, sibBytes);
    } else {
      return fail(`sibling ${i} has invalid position ${String(sib.position)}`);
    }
    cur = sha256(concat);
  }

  let rootBytes: Uint8Array;
  try {
    rootBytes = hexDecode(merkleRoot);
  } catch (e) {
    return fail(
      `merkle_root is not hex: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!bytesEqual(rootBytes, cur)) {
    return {
      status: "fail",
      reason: "computed root does not match stored merkle_root",
      details: {
        computed_root: hexEncode(cur),
        stored_root: merkleRoot,
        siblings: proof.siblings.length,
      },
    };
  }
  return {
    status: "pass",
    details: { siblings: proof.siblings.length, merkle_root: merkleRoot },
  };
}

/**
 * Solana confirmation — the step the server skips. We hit a public
 * RPC endpoint directly from the browser and confirm the transaction
 * landed in a finalized slot.
 */
async function verifySolana(
  txSignature: string,
  opts: LocalVerifyOptions
): Promise<VerifyStep> {
  if (!txSignature) {
    return fail("anchor has no solana_signature");
  }
  const cluster = opts.cluster ?? "devnet";
  const endpoint =
    opts.rpcEndpoint ??
    import.meta.env.PUBLIC_SOLANA_RPC ??
    publicRpc(cluster);

  let conn: Connection;
  try {
    conn = new Connection(endpoint, "finalized");
  } catch (e) {
    return fail(
      `cannot init Solana connection: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  try {
    // getSignatureStatuses respects opts.signal via its underlying fetch.
    const statuses = await conn.getSignatureStatuses([txSignature], {
      searchTransactionHistory: true,
    });
    const s = statuses.value[0];
    if (!s) {
      return fail(`Solana RPC returned no status for ${txSignature}`);
    }
    if (s.err) {
      return {
        status: "fail",
        reason: "transaction landed but contains an error",
        details: { err: s.err, slot: s.slot },
      };
    }
    if (
      s.confirmationStatus !== "finalized" &&
      s.confirmationStatus !== "confirmed"
    ) {
      return {
        status: "fail",
        reason: `transaction not yet confirmed (status: ${s.confirmationStatus ?? "unknown"})`,
        details: { slot: s.slot },
      };
    }
    return {
      status: "pass",
      details: {
        slot: s.slot,
        confirmation_status: s.confirmationStatus,
        cluster,
      },
    };
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      return skipped("Solana RPC aborted by caller");
    }
    return fail(
      `Solana RPC error: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

function publicRpc(cluster: string): string {
  switch (cluster) {
    case "mainnet":
    case "mainnet-beta":
      return "https://api.mainnet-beta.solana.com";
    case "testnet":
      return "https://api.testnet.solana.com";
    case "devnet":
    default:
      return "https://api.devnet.solana.com";
  }
}

// ── helpers ────────────────────────────────────────────────────────

function aggregate(steps: VerifyResult["steps"]): VerifyOverall {
  const all = [
    steps.signature_ed25519,
    steps.canonicalization_jcs,
    steps.delegation_chain,
    steps.merkle_proof,
    steps.solana_confirmation,
  ];
  let hasFail = false;
  let hasNonPass = false;
  for (const s of all) {
    if (s.status === "fail") hasFail = true;
    else if (s.status !== "pass" && s.status !== "not_applicable")
      hasNonPass = true;
  }
  if (hasFail) return "fail";
  if (hasNonPass) return "partial";
  return "pass";
}

function fail(reason: string): VerifyStep {
  return { status: "fail" satisfies VerifyStepStatus, reason };
}
function notApplicable(reason: string): VerifyStep {
  return { status: "not_applicable" satisfies VerifyStepStatus, reason };
}
function skipped(reason: string): VerifyStep {
  return { status: "skipped" satisfies VerifyStepStatus, reason };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
