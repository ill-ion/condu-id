/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Public — embedded in client bundles. The API origin the verifier
   * widget and chat client talk to.
   */
  readonly PUBLIC_API_BASE: string;
  /** Solana cluster name; used for explorer URL construction. */
  readonly PUBLIC_SOLANA_CLUSTER: "devnet" | "testnet" | "mainnet" | "mainnet-beta";
  /** Solana RPC endpoint the browser hits directly during verification. */
  readonly PUBLIC_SOLANA_RPC: string;

  /**
   * Server-side only — never inlined into client bundles.
   * Anthropic API key for the /api/chat handler.
   */
  readonly ANTHROPIC_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Cloudflare Workers runtime context. Cloudflare Pages provides
 * `runtime.env` for secrets at request time.
 */
type Runtime = import("@astrojs/cloudflare").Runtime<{
  ANTHROPIC_API_KEY: string;
}>;

declare namespace App {
  interface Locals extends Runtime {}
}
