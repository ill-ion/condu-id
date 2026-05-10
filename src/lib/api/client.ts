/**
 * Typed client for api.condu.id.
 *
 * Used in three places:
 *   1. Astro page frontmatter (build-time): static pages fetch their data
 *      here during `astro build`.
 *   2. Astro server endpoints (request-time): DID document handlers and
 *      the chat handler use it for live lookups.
 *   3. Browser (client-time): the verifier widget fetches receipts and
 *      DID documents directly from the API to do its own checks.
 *
 * Same code path in all three contexts — `fetch` is universal. The
 * client never assumes Node-only globals.
 */

import type {
  Agent,
  Anchor,
  ApiError,
  DIDResolution,
  Health,
  Page,
  Receipt,
  ReceiptSummary,
  Server,
  VerifyResult,
} from "./types";

export class ApiClientError extends Error {
  status: number;
  code: string;
  requestId?: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    body: ApiError | { error?: { code?: string; message?: string } } | string
  ) {
    let code = "internal";
    let message = `HTTP ${status}`;
    let requestId: string | undefined;
    let details: Record<string, unknown> | undefined;

    if (typeof body === "string") {
      message = body || message;
    } else if (body && typeof body === "object" && "error" in body) {
      const e = body.error;
      if (e) {
        if (typeof e.code === "string") code = e.code;
        if (typeof e.message === "string") message = e.message;
        if ("request_id" in e && typeof e.request_id === "string") {
          requestId = e.request_id;
        }
        if ("details" in e && e.details && typeof e.details === "object") {
          details = e.details as Record<string, unknown>;
        }
      }
    }

    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** Convenience: was this a 404? */
  get notFound(): boolean {
    return this.status === 404;
  }
}

/** Resolve the API base from build-time env. Defaults to production. */
export function getApiBase(): string {
  const v = import.meta.env.PUBLIC_API_BASE;
  if (typeof v === "string" && v) return v.replace(/\/$/, "");
  return "https://api.condu.id";
}

type FetchOpts = {
  /** Cloudflare-only: cache-control hint passed to fetch. */
  cf?: { cacheTtl?: number; cacheEverything?: boolean };
  /** Override base URL — used by server-side handlers calling api on a private network. */
  base?: string;
  /** Pass an AbortSignal for client-side cancellation. */
  signal?: AbortSignal;
};

async function get<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const base = (opts.base ?? getApiBase()).replace(/\/$/, "");
  const url = `${base}${path}`;

  const init: RequestInit & { cf?: unknown } = {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: opts.signal,
  };
  if (opts.cf) init.cf = opts.cf;

  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    let body: ApiError | string = text;
    try {
      body = JSON.parse(text) as ApiError;
    } catch {
      // not JSON, leave as text
    }
    throw new ApiClientError(res.status, body);
  }
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

// ── public helpers ─────────────────────────────────────────────────

export const api = {
  health: (opts?: FetchOpts) => get<Health>("/v1/health", opts),

  listServers: (
    params: {
      cursor?: string;
      limit?: number;
      q?: string;
      category?: string;
      has_receipts?: boolean;
    } = {},
    opts?: FetchOpts
  ) => get<Page<Server>>(`/v1/servers${query(params)}`, opts),

  getServer: (slug: string, opts?: FetchOpts) =>
    get<Server>(`/v1/servers/${enc(slug)}`, opts),

  getServerDID: (slug: string, opts?: FetchOpts) =>
    get<Record<string, unknown>>(`/v1/servers/${enc(slug)}/did.json`, opts),

  listServerAgents: (
    slug: string,
    params: { cursor?: string; limit?: number } = {},
    opts?: FetchOpts
  ) =>
    get<Page<Agent>>(
      `/v1/servers/${enc(slug)}/agents${query(params)}`,
      opts
    ),

  listServerReceipts: (
    slug: string,
    params: {
      cursor?: string;
      limit?: number;
      anchored?: boolean;
      action_type?: string;
    } = {},
    opts?: FetchOpts
  ) =>
    get<Page<ReceiptSummary>>(
      `/v1/servers/${enc(slug)}/receipts${query(params)}`,
      opts
    ),

  getAgent: (slug: string, opts?: FetchOpts) =>
    get<Agent>(`/v1/agents/${enc(slug)}`, opts),

  getAgentDID: (slug: string, opts?: FetchOpts) =>
    get<Record<string, unknown>>(`/v1/agents/${enc(slug)}/did.json`, opts),

  listAgentReceipts: (
    slug: string,
    params: { cursor?: string; limit?: number; anchored?: boolean } = {},
    opts?: FetchOpts
  ) =>
    get<Page<ReceiptSummary>>(
      `/v1/agents/${enc(slug)}/receipts${query(params)}`,
      opts
    ),

  listReceipts: (
    params: {
      cursor?: string;
      limit?: number;
      anchored?: boolean;
      action_type?: string;
      server_slug?: string;
      agent_slug?: string;
    } = {},
    opts?: FetchOpts
  ) => get<Page<ReceiptSummary>>(`/v1/receipts${query(params)}`, opts),

  getReceipt: (id: string, opts?: FetchOpts) =>
    get<Receipt>(`/v1/receipts/${enc(id)}`, opts),

  /**
   * Server-side convenience verify. NEVER authoritative — clients MUST
   * re-verify locally. We fetch this only to surface what the server
   * thinks; the verifier widget runs its own checks regardless.
   */
  verifyReceipt: (id: string, opts?: FetchOpts) =>
    get<VerifyResult>(`/v1/receipts/${enc(id)}/verify`, opts),

  getAnchor: (merkleRoot: string, opts?: FetchOpts) =>
    get<Anchor>(`/v1/anchors/${enc(merkleRoot)}`, opts),

  resolveDID: (did: string, opts?: FetchOpts) =>
    get<DIDResolution>(
      `/v1/dids/resolve?did=${encodeURIComponent(did)}`,
      opts
    ),
};

// ── helpers ────────────────────────────────────────────────────────

function enc(s: string): string {
  return encodeURIComponent(s);
}

function query(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}
