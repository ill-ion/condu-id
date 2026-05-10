/**
 * TypeScript surface for api.condu.id.
 *
 * Source of truth: ../../../condu-id-api/api/openapi.yaml
 *
 * Hand-written to avoid a codegen build step. When the OpenAPI spec
 * changes, sync this file. The tests in src/lib/api/api.test.ts are
 * round-trip checks against fixtures captured from the live API.
 */

// ── pagination ─────────────────────────────────────────────────────

export type Pagination = {
  next_cursor: string | null;
  has_more: boolean;
};

export type Page<T> = {
  data: T[];
  pagination: Pagination;
};

// ── error envelope ─────────────────────────────────────────────────

export type ApiError = {
  error: {
    code:
      | "bad_request"
      | "not_found"
      | "gone"
      | "rate_limited"
      | "upstream_unavailable"
      | "not_implemented"
      | "internal";
    message: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
};

// ── identities ─────────────────────────────────────────────────────

export type VerificationMethodRef = {
  id: string;
  type: "JsonWebKey2020" | "Ed25519VerificationKey2020" | "Multikey";
  controller: string;
  public_key_jwk?: Record<string, unknown>;
  public_key_multibase?: string;
};

export type Server = {
  slug: string;
  did: string;
  name: string;
  description?: string;
  homepage?: string;
  repository?: string;
  categories?: string[];
  verification_method?: VerificationMethodRef[];
  receipt_count: number;
  agent_count: number;
  first_seen_at?: string;
  last_active_at: string | null;
  deactivated: boolean;
  deactivated_at: string | null;
  did_document_url: string;
  created_at: string;
};

export type Agent = {
  slug: string;
  local_id?: string;
  did: string;
  parent_did: string;
  server_slug: string;
  name?: string;
  description?: string;
  verification_method?: VerificationMethodRef[];
  receipt_count: number;
  first_seen_at: string;
  last_active_at: string | null;
  deactivated: boolean;
  deactivated_at: string | null;
  did_document_url: string;
  created_at: string;
};

// ── DID core ───────────────────────────────────────────────────────

export type DIDDocument = {
  "@context": string | string[];
  id: string;
  controller?: string | string[];
  alsoKnownAs?: string[];
  verificationMethod?: Array<Record<string, unknown>>;
  authentication?: Array<string | Record<string, unknown>>;
  assertionMethod?: Array<string | Record<string, unknown>>;
  service?: Array<Record<string, unknown>>;
  deactivated?: boolean;
  [k: string]: unknown;
};

export type DIDResolution = {
  did_document: DIDDocument;
  did_resolution_metadata: {
    content_type: string;
    error?: "invalidDid" | "notFound" | "methodNotSupported" | "internalError";
    [k: string]: unknown;
  };
  did_document_metadata: {
    created?: string;
    updated?: string;
    deactivated?: boolean;
    [k: string]: unknown;
  };
};

// ── receipts ───────────────────────────────────────────────────────

export type SignedReceiptBody = {
  rcpt_version: string;
  receipt_id: string;
  action_type:
    | "tool_call"
    | "delegation"
    | "identity_attest"
    | "capability_grant"
    | "generic";
  signed_by: string;
  signature: string;
  issued_at: string;
  subject_did?: string;
  agent_did?: string;
  scope?: string[];
  input_hash?: string;
  output_hash?: string;
  delegation?: Record<string, unknown>;
  valid_until?: string;
  [k: string]: unknown;
};

export type MerkleProof = {
  leaf: string;
  leaf_index: number;
  siblings: Array<{ hash: string; position: "left" | "right" }>;
  [k: string]: unknown;
};

export type ReceiptAnchor = {
  merkle_root: string;
  solana_signature: string;
  solana_slot: number;
  cluster: "devnet" | "testnet" | "mainnet";
  anchored_at: string;
  merkle_proof: MerkleProof;
  explorer_url?: string;
};

export type ReceiptIdentity = {
  server_slug: string | null;
  agent_slug: string | null;
  server_did: string | null;
  agent_did: string | null;
  signer_did_document_url: string | null;
};

export type Receipt = {
  id: string;
  receipt: SignedReceiptBody;
  anchor: ReceiptAnchor | null;
  identity: ReceiptIdentity;
  created_at: string;
};

export type ReceiptSummary = {
  id: string;
  action_type: string;
  signed_by: string;
  subject_did: string | null;
  server_slug: string;
  agent_slug: string | null;
  created_at: string;
  anchored: boolean;
  anchored_at: string | null;
  solana_signature: string | null;
};

// ── verify ─────────────────────────────────────────────────────────

export type VerifyStepStatus = "pass" | "fail" | "skipped" | "not_applicable";
export type VerifyOverall = VerifyStepStatus | "partial";

export type VerifyStep = {
  status: VerifyStepStatus;
  reason?: string;
  details?: Record<string, unknown>;
};

export type VerifyResult = {
  authoritative: false; // always
  notice: "client-must-verify"; // always
  overall: VerifyOverall;
  steps: {
    signature_ed25519: VerifyStep;
    canonicalization_jcs: VerifyStep;
    delegation_chain: VerifyStep;
    merkle_proof: VerifyStep;
    solana_confirmation: VerifyStep;
  };
  checked_at: string;
};

// ── anchors ────────────────────────────────────────────────────────

export type Anchor = {
  merkle_root: string;
  cluster: "devnet" | "testnet" | "mainnet";
  status: "pending" | "anchored" | "failed";
  solana_signature: string | null;
  solana_slot: number | null;
  receipt_count: number;
  receipt_ids: string[];
  attempt_count?: number;
  error: string | null;
  created_at: string;
  anchored_at: string | null;
  explorer_url: string | null;
};

// ── health ─────────────────────────────────────────────────────────

export type Health = {
  status: "healthy" | "unhealthy";
  checks?: Record<string, { ok: boolean; error?: string }>;
  version?: string;
  time: string;
};
